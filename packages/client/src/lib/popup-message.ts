import type { ShareDestination } from "~/lib/share-store";

/** The toolbar popup asking the background to add a page: the popup closes as soon as it's kept. */
export const MSG_POPUP_ADD = "ajot-popup-add";

export type PopupAdd = {
  type: typeof MSG_POPUP_ADD;
  tabId: number | undefined;
  title: string;
  description: string | null;
  to: ShareDestination;
  /** The page's picture to attach, if the popup was let read it. */
  picture: string | null;
  /** What the page's toast says once it's in, such as "Added to Work". */
  done: string;
  /** Opens it in Ajot instead, in the Inbox, with its sheet open to edit. */
  open: boolean;
};

export type PopupReply = { kept: boolean };

export const isPopupAdd = (message: unknown): message is PopupAdd =>
  (message as { type?: unknown } | null)?.type === MSG_POPUP_ADD;
