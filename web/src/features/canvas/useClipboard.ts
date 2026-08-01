"use client";

import { useEffect } from "react";

import { decodeNode, encodeNode } from "@/lib/clipboard";
import type { DesignNode } from "@/lib/topology";

/**
 * Whether the caret is somewhere the user is typing.
 *
 * The settings dialog is full of inputs, and Ctrl+C in one of them means copy
 * this number — not copy the component the dialog is about. Answering the same
 * keystroke two ways depending on where focus is looks like a special case and
 * is the opposite: the browser has always done this, and a handler on the
 * document is what would break it.
 */
function typing(target: EventTarget | null): boolean {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    return true;
  }
  return target instanceof HTMLElement && target.isContentEditable;
}

/**
 * Whether the browser already has something of its own to copy.
 *
 * Selected text beats a selected component. Someone who has dragged across a
 * paragraph and pressed Ctrl+C wants the paragraph, and there is no way to
 * give them both — so the rule is that a canvas selection only wins when
 * nothing more specific is selected.
 */
function copyingText(event: ClipboardEvent): boolean {
  return typing(event.target) || (window.getSelection()?.toString() ?? "") !== "";
}

/**
 * Ctrl+C and Ctrl+V over the design.
 *
 * Listening for `copy` and `paste` rather than for the keystrokes, which is
 * both simpler and the only version that works. The keystroke is not the same
 * on every platform — it is Cmd on a Mac — and reading the clipboard from a
 * keydown handler needs `navigator.clipboard.readText`, which prompts for a
 * permission the first time and is refused outright if the user says no. These
 * events carry the clipboard with them and are already fired by whatever
 * gesture that platform uses to copy.
 *
 * On the document rather than on the canvas element. A canvas listener would
 * need the canvas focused, and clicking a component to select it does not
 * focus the pane — so the component you had just chosen would be the one you
 * could not copy.
 */
export function useClipboard(selected: DesignNode | undefined, paste: (node: DesignNode) => void) {
  useEffect(() => {
    const onCopy = (event: ClipboardEvent) => {
      if (selected === undefined || event.clipboardData === null || copyingText(event)) {
        return;
      }
      event.clipboardData.setData("text/plain", encodeNode(selected));
      // Only now, and only on this path: the default is what puts the
      // selection on the clipboard, and preventing it before deciding to
      // write something would be a Ctrl+C that empties the clipboard.
      event.preventDefault();
    };

    const onPaste = (event: ClipboardEvent) => {
      if (event.clipboardData === null || typing(event.target)) {
        return;
      }
      const node = decodeNode(event.clipboardData.getData("text/plain"));
      if (node === null) {
        return;
      }
      event.preventDefault();
      paste(node);
    };

    document.addEventListener("copy", onCopy);
    document.addEventListener("paste", onPaste);
    return () => {
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("paste", onPaste);
    };
  }, [selected, paste]);
}
