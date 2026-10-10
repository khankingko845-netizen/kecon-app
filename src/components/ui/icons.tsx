/**
 * KểCon icon set (UI v2 — ticket UI-03).
 *
 * Phosphor Icons (MIT) behind the lucide-react names the app already used, so
 * screens only change their import path. Style rules:
 *  - default weight "duotone" (soft, kid-friendly); small icons (≤ 18px) use "bold" for legibility
 *  - lucide-compat props: `fill="currentColor"` (or a colour) → weight "fill", `fill="none"` → outline,
 *    `strokeWidth ≥ 2.5` → "bold"
 *  - decorative by default (`aria-hidden`) unless an accessible name is given.
 */
import { forwardRef, type ComponentPropsWithoutRef, type ForwardRefExoticComponent, type RefAttributes } from "react";
import type { IconWeight, Icon as PhosphorIcon } from "@phosphor-icons/react";
import {
  ArrowCounterClockwiseIcon,
  ArrowClockwiseIcon,
  ArrowRightIcon,
  ArrowLeftIcon,
  ArrowSquareOutIcon,
  ArrowUUpLeftIcon,
  ArrowsClockwiseIcon,
  BabyIcon,
  BellIcon,
  BookOpenIcon,
  BookmarkSimpleIcon,
  BooksIcon,
  BrainIcon,
  BugIcon,
  CalendarIcon,
  CameraIcon,
  CaretDownIcon,
  CaretLeftIcon,
  CaretRightIcon,
  CaretUpIcon,
  CastleTurretIcon,
  ChartBarIcon,
  ChatCenteredTextIcon,
  ChatCircleIcon,
  CheckIcon,
  CheckCircleIcon,
  CheckSquareIcon,
  CircleNotchIcon,
  ClockIcon,
  ClockCounterClockwiseIcon,
  CloudMoonIcon,
  CloudRainIcon,
  CopyIcon,
  CreditCardIcon,
  CrownIcon,
  CubeIcon,
  DotsSixVerticalIcon,
  DotsThreeIcon,
  DownloadSimpleIcon,
  EnvelopeIcon,
  EraserIcon,
  EyeIcon,
  EyeSlashIcon,
  FileTextIcon,
  FlameIcon,
  FloppyDiskIcon,
  FolderOpenIcon,
  GearIcon,
  GiftIcon,
  GitBranchIcon,
  GlobeIcon,
  HardDriveIcon,
  HeadphonesIcon,
  HeartIcon,
  HouseIcon,
  ImageIcon,
  ImageSquareIcon,
  InfoIcon,
  KeyIcon,
  LeafIcon,
  LightbulbIcon,
  LightningIcon,
  LinkIcon,
  ListBulletsIcon,
  LockIcon,
  LockKeyIcon,
  MagicWandIcon,
  MagnifyingGlassIcon,
  MicrophoneIcon,
  MoonIcon,
  MoonStarsIcon,
  MusicNotesIcon,
  PaletteIcon,
  PaperPlaneRightIcon,
  PauseIcon,
  PawPrintIcon,
  PencilLineIcon,
  PencilSimpleIcon,
  PlayIcon,
  PlugIcon,
  PlusIcon,
  RocketIcon,
  RulerIcon,
  ShareNetworkIcon,
  ShieldIcon,
  ShieldCheckIcon,
  ShuffleIcon,
  SignInIcon,
  SignOutIcon,
  SkipBackIcon,
  SkipForwardIcon,
  SlidersHorizontalIcon,
  SortAscendingIcon,
  SortDescendingIcon,
  SparkleIcon,
  SpeakerHighIcon,
  SpeakerSimpleSlashIcon,
  SquareIcon,
  SquaresFourIcon,
  StarIcon,
  SunIcon,
  TargetIcon,
  TimerIcon,
  TrashIcon,
  TreeIcon,
  TreeEvergreenIcon,
  TrendUpIcon,
  TrophyIcon,
  HourglassMediumIcon,
  UploadSimpleIcon,
  UserIcon,
  UserCircleIcon,
  UsersIcon,
  WarningIcon,
  WarningCircleIcon,
  WaveformIcon,
  VibrateIcon,
  WavesIcon,
  WifiHighIcon,
  WifiSlashIcon,
  WindIcon,
  XIcon,
  XCircleIcon,
} from "@phosphor-icons/react/ssr";

export type { IconWeight };

export interface IconProps extends Omit<ComponentPropsWithoutRef<"svg">, "fill" | "strokeWidth"> {
  size?: number | string;
  weight?: IconWeight;
  color?: string;
  mirrored?: boolean;
  /** lucide-compat: any colour → weight "fill"; "none" → outline. */
  fill?: string;
  /** lucide-compat: ≥ 2.5 → weight "bold". */
  strokeWidth?: number | string;
  /** lucide-compat, ignored. */
  absoluteStrokeWidth?: boolean;
}

export type IconComponent = ForwardRefExoticComponent<IconProps & RefAttributes<SVGSVGElement>>;

const SMALL_CLASS = /(?:^|\s)(?:w|h|size)-(?:2|2\.5|3|3\.5|4)(?:\s|$)/;

/** Picks the Phosphor weight for a lucide-style call site. Exported for tests. */
export function resolveWeight(
  p: Pick<IconProps, "weight" | "fill" | "strokeWidth" | "size" | "className">,
  fallback?: IconWeight
): IconWeight {
  if (p.weight) return p.weight;
  if (p.fill && p.fill !== "none") return "fill";
  if (p.strokeWidth !== undefined && Number(p.strokeWidth) >= 2.5) return "bold";
  if (fallback) return fallback;
  if (p.fill === "none") return "bold";
  const px = typeof p.size === "number" ? p.size : Number.parseFloat(String(p.size ?? "24"));
  if ((Number.isFinite(px) && px <= 18) || (p.className && SMALL_CLASS.test(p.className))) return "bold";
  return "duotone";
}

function make(Ph: PhosphorIcon, name: string, defaultWeight?: IconWeight): IconComponent {
  const C = forwardRef<SVGSVGElement, IconProps>(function KeConIcon(
    { size = 24, weight, fill, strokeWidth, absoluteStrokeWidth: _abs, color, className, ...rest },
    ref
  ) {
    const w = resolveWeight({ weight, fill, strokeWidth, size, className }, defaultWeight);
    const c = color ?? (fill && fill !== "none" && fill !== "currentColor" ? fill : undefined);
    const named = Boolean(rest["aria-label"] || rest["aria-labelledby"] || rest.role === "img");
    return (
      <Ph
        ref={ref}
        size={size}
        weight={w}
        color={c}
        className={className}
        aria-hidden={named ? undefined : true}
        {...rest}
      />
    );
  });
  C.displayName = name;
  return C;
}

export const Loader2 = make(CircleNotchIcon, "Loader2", "bold");
export const Mic = make(MicrophoneIcon, "Mic");
export const Sparkles = make(SparkleIcon, "Sparkles");
export const X = make(XIcon, "X");
export const Trash2 = make(TrashIcon, "Trash2");
export const BookOpen = make(BookOpenIcon, "BookOpen");
export const ChevronLeft = make(CaretLeftIcon, "ChevronLeft", "bold");
export const Check = make(CheckIcon, "Check", "bold");
export const Star = make(StarIcon, "Star");
export const Play = make(PlayIcon, "Play");
export const Heart = make(HeartIcon, "Heart");
export const Plus = make(PlusIcon, "Plus", "bold");
export const Pencil = make(PencilSimpleIcon, "Pencil");
export const Search = make(MagnifyingGlassIcon, "Search");
export const User = make(UserIcon, "User");
export const Globe = make(GlobeIcon, "Globe");
export const AlertCircle = make(WarningCircleIcon, "AlertCircle");
export const Volume2 = make(SpeakerHighIcon, "Volume2");
export const Eye = make(EyeIcon, "Eye");
export const Moon = make(MoonIcon, "Moon");
export const Trophy = make(TrophyIcon, "Trophy");
export const Users = make(UsersIcon, "Users");
export const EyeOff = make(EyeSlashIcon, "EyeOff");
export const Square = make(SquareIcon, "Square");
export const Shield = make(ShieldIcon, "Shield");
export const Flame = make(FlameIcon, "Flame");
export const Headphones = make(HeadphonesIcon, "Headphones");
export const FileText = make(FileTextIcon, "FileText");
export const Settings = make(GearIcon, "Settings");
export const ChevronDown = make(CaretDownIcon, "ChevronDown", "bold");
export const RotateCcw = make(ArrowCounterClockwiseIcon, "RotateCcw");
export const UserRound = make(UserCircleIcon, "UserRound");
export const CheckCircle = make(CheckCircleIcon, "CheckCircle");
export const Clock = make(ClockIcon, "Clock");
export const History = make(ClockCounterClockwiseIcon, "History");
export const Zap = make(LightningIcon, "Zap");
export const TrendingUp = make(TrendUpIcon, "TrendingUp");
export const CheckCircle2 = make(CheckCircleIcon, "CheckCircle2");
export const Upload = make(UploadSimpleIcon, "Upload");
export const BarChart3 = make(ChartBarIcon, "BarChart3");
export const FolderOpen = make(FolderOpenIcon, "FolderOpen");
export const Save = make(FloppyDiskIcon, "Save");
export const Bell = make(BellIcon, "Bell");
export const Share2 = make(ShareNetworkIcon, "Share2");
export const Lock = make(LockIcon, "Lock");
export const ChevronRight = make(CaretRightIcon, "ChevronRight", "bold");
export const Baby = make(BabyIcon, "Baby");
export const Pause = make(PauseIcon, "Pause");
export const ShieldCheck = make(ShieldCheckIcon, "ShieldCheck");
export const WifiOff = make(WifiSlashIcon, "WifiOff");
export const Lightbulb = make(LightbulbIcon, "Lightbulb");
export const AlertTriangle = make(WarningIcon, "AlertTriangle");
export const ExternalLink = make(ArrowSquareOutIcon, "ExternalLink");
export const Brain = make(BrainIcon, "Brain");
export const Image = make(ImageIcon, "Image");
export const Bookmark = make(BookmarkSimpleIcon, "Bookmark");
export const Copy = make(CopyIcon, "Copy");
export const Download = make(DownloadSimpleIcon, "Download");
export const LayoutDashboard = make(SquaresFourIcon, "LayoutDashboard");
export const Camera = make(CameraIcon, "Camera");
export const Mail = make(EnvelopeIcon, "Mail");
export const Calendar = make(CalendarIcon, "Calendar");
export const Info = make(InfoIcon, "Info");
export const Crown = make(CrownIcon, "Crown");
export const ChevronUp = make(CaretUpIcon, "ChevronUp", "bold");
export const SkipBack = make(SkipBackIcon, "SkipBack");
export const SkipForward = make(SkipForwardIcon, "SkipForward");
export const MessageSquare = make(ChatCenteredTextIcon, "MessageSquare");
export const Target = make(TargetIcon, "Target");
export const GripVertical = make(DotsSixVerticalIcon, "GripVertical", "bold");
export const PenLine = make(PencilLineIcon, "PenLine");
export const LayoutList = make(ListBulletsIcon, "LayoutList");
export const RefreshCw = make(ArrowsClockwiseIcon, "RefreshCw");
export const Plug = make(PlugIcon, "Plug");
export const CheckSquare = make(CheckSquareIcon, "CheckSquare");
export const Leaf = make(LeafIcon, "Leaf");
export const Castle = make(CastleTurretIcon, "Castle");
export const Rocket = make(RocketIcon, "Rocket");
export const PawPrint = make(PawPrintIcon, "PawPrint");
export const Blocks = make(CubeIcon, "Blocks");
export const Gift = make(GiftIcon, "Gift");
export const Wifi = make(WifiHighIcon, "Wifi");
export const HardDrive = make(HardDriveIcon, "HardDrive");
export const Palette = make(PaletteIcon, "Palette");
export const Eraser = make(EraserIcon, "Eraser");
export const Undo2 = make(ArrowUUpLeftIcon, "Undo2");
export const Sun = make(SunIcon, "Sun");
export const CloudMoon = make(CloudMoonIcon, "CloudMoon");
export const SortAsc = make(SortAscendingIcon, "SortAsc");
export const SortDesc = make(SortDescendingIcon, "SortDesc");
export const LogIn = make(SignInIcon, "LogIn");
export const CloudRain = make(CloudRainIcon, "CloudRain");
export const Waves = make(WavesIcon, "Waves");
export const Music = make(MusicNotesIcon, "Music");
export const Bug = make(BugIcon, "Bug");
export const Wind = make(WindIcon, "Wind");
export const Trees = make(TreeEvergreenIcon, "Trees");
export const ImagePlus = make(ImageSquareIcon, "ImagePlus");
export const Key = make(KeyIcon, "Key");
export const LogOut = make(SignOutIcon, "LogOut");
export const GitBranch = make(GitBranchIcon, "GitBranch");
export const MoreHorizontal = make(DotsThreeIcon, "MoreHorizontal", "bold");
export const Shuffle = make(ShuffleIcon, "Shuffle");
export const SlidersHorizontal = make(SlidersHorizontalIcon, "SlidersHorizontal");
export const Send = make(PaperPlaneRightIcon, "Send");
export const CreditCard = make(CreditCardIcon, "CreditCard");
export const ArrowRight = make(ArrowRightIcon, "ArrowRight", "bold");
export const Wand2 = make(MagicWandIcon, "Wand2");
export const XCircle = make(XCircleIcon, "XCircle");
export const TreeDeciduous = make(TreeIcon, "TreeDeciduous");
export const Link2 = make(LinkIcon, "Link2");
export const MessageCircle = make(ChatCircleIcon, "MessageCircle");
export const Home = make(HouseIcon, "Home");
export const Books = make(BooksIcon, "Books");
export const MoonStars = make(MoonStarsIcon, "MoonStars");
export const Timer = make(TimerIcon, "Timer");
export const Waveform = make(WaveformIcon, "Waveform");
export const Vibrate = make(VibrateIcon, "Vibrate");
export const EyeSlash = make(EyeSlashIcon, "EyeSlash");
export const RotateCw = make(ArrowClockwiseIcon, "RotateCw");
export const ArrowLeft = make(ArrowLeftIcon, "ArrowLeft", "bold");
export const LockKey = make(LockKeyIcon, "LockKey");
export const Ruler = make(RulerIcon, "Ruler");
export const SpeakerSlash = make(SpeakerSimpleSlashIcon, "SpeakerSlash");
export const Hourglass = make(HourglassMediumIcon, "Hourglass");
