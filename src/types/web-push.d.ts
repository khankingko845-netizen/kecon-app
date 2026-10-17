declare module "web-push" {
  export function setVapidDetails(
    subject: string,
    publicKey: string,
    privateKey: string
  ): void;

  export function sendNotification(
    subscription: object,
    payload: string | Buffer | null,
    options?: object
  ): Promise<object>;

  export function generateVAPIDKeys(): {
    publicKey: string;
    privateKey: string;
  };
}
