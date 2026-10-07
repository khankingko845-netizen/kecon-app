import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import sharp from "sharp";
const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  upload: vi.fn(),
  download: vi.fn(),
  remove: vi.fn(),
  single: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: mocks.getUser },
    storage: {
      from: () => ({
        upload: mocks.upload,
        download: mocks.download,
        remove: mocks.remove,
      }),
    },
    from: () => ({ select: () => ({ eq: () => ({ single: mocks.single }) }) }),
  }),
}));
import { POST } from "@/app/api/profile/avatar/route";
import { GET, DELETE } from "@/app/api/profile/avatar/[id]/route";
const user = "11111111-1111-4111-8111-111111111111",
  id = "22222222-2222-4222-8222-222222222222";
const context = { params: Promise.resolve({ id }) };
const req = (init: RequestInit) =>
  new Request("http://local/api/profile/avatar", init) as NextRequest;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: user } } });
  mocks.upload.mockResolvedValue({ error: null });
  mocks.single.mockResolvedValue({ data: { avatar_url: null }, error: null });
});
const imageForm = (data: Buffer) => {
  const form = new FormData();
  form.append(
    "file",
    new File([new Uint8Array(data)], "family.jpg", { type: "image/jpeg" }),
  );
  return form;
};
describe("avatar endpoint boundary", () => {
  it("requires authentication before reading a file", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    expect(
      (await POST(req({ method: "POST", body: imageForm(Buffer.from("bad")) })))
        .status,
    ).toBe(401);
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("blocks cross-site and invalid content type", async () => {
    expect(
      (
        await POST(
          req({
            method: "POST",
            headers: { "sec-fetch-site": "cross-site" },
            body: imageForm(Buffer.from("bad")),
          }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await POST(
          req({
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{}",
          }),
        )
      ).status,
    ).toBe(415);
  });
  it("rejects an oversized streamed request without Content-Length", async () => {
    const response = await POST(
      req({
        method: "POST",
        headers: { "content-type": "multipart/form-data; boundary=x" },
        body: new Uint8Array(6 * 1024 * 1024),
      }),
    );
    expect(response.status).toBe(413);
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("rejects fake raster MIME and malformed multipart", async () => {
    expect(
      (
        await POST(
          req({ method: "POST", body: imageForm(Buffer.from("<svg/>")) }),
        )
      ).status,
    ).toBe(400);
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("stores normalized bytes under the current user only", async () => {
    const img = await sharp({
      create: { width: 60, height: 90, channels: 3, background: "#fff" },
    })
      .jpeg()
      .toBuffer();
    const response = await POST(req({ method: "POST", body: imageForm(img) }));
    expect(response.status).toBe(201);
    expect((await response.json()).avatarUrl).toMatch(
      /^\/api\/profile\/avatar\/[a-f0-9-]+$/,
    );
    expect(mocks.upload.mock.calls[0][0]).toMatch(
      new RegExp(`^${user}/[a-f0-9-]+\\.webp$`),
    );
    expect((await sharp(mocks.upload.mock.calls[0][1]).metadata()).width).toBe(
      512,
    );
  });
  it("does not leak a storage error", async () => {
    mocks.upload.mockResolvedValue({
      error: { message: "private storage key" },
    });
    const img = await sharp({
      create: { width: 50, height: 50, channels: 3, background: "#fff" },
    })
      .png()
      .toBuffer();
    const response = await POST(req({ method: "POST", body: imageForm(img) }));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("storage key");
  });
  it("reads a private object only under the authenticated owner", async () => {
    mocks.download.mockResolvedValue({ data: new Blob(["x"]), error: null });
    const response = await GET(req({}), context);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.download).toHaveBeenCalledWith(`${user}/${id}.webp`);
  });
  it("refuses malformed id and deletes only an unreferenced own object", async () => {
    expect(
      (await GET(req({}), { params: Promise.resolve({ id: "../x" }) })).status,
    ).toBe(404);
    mocks.single.mockResolvedValue({
      data: { avatar_url: `/api/profile/avatar/${id}` },
      error: null,
    });
    expect((await DELETE(req({ method: "DELETE" }), context)).status).toBe(409);
    expect(mocks.remove).not.toHaveBeenCalled();
    mocks.single.mockResolvedValue({ data: { avatar_url: null }, error: null });
    mocks.remove.mockResolvedValue({ error: null });
    expect((await DELETE(req({ method: "DELETE" }), context)).status).toBe(200);
    expect(mocks.remove).toHaveBeenCalledWith([`${user}/${id}.webp`]);
  });
});
