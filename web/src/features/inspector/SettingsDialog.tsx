"use client";

import { useEffect, useRef } from "react";

import { Inspector } from "@/features/inspector/Inspector";
import type { Contract } from "@/lib/describe";
import type { DesignNode } from "@/lib/topology";

interface SettingsDialogProps {
  readonly node: DesignNode | undefined;
  readonly wiring: { incoming: Contract[]; outgoing: Contract[] };
  readonly open: boolean;
  readonly onChange: (node: DesignNode) => void;
  readonly onRemove: (id: string) => void;
  readonly onClose: () => void;
}

/**
 * A component's settings, over the design rather than beside it.
 *
 * The settings used to live in a permanent panel down the right-hand side,
 * where they were one of three panels drawing identical rows of numbers and
 * nothing said which of them a given number belonged to. Bringing them up on
 * the component answers that before it can be asked: what is on screen is what
 * was clicked.
 *
 * A native `<dialog>`, not a div with a high z-index. Focus moves into it and
 * is trapped there, Escape closes it, the rest of the page goes inert, and the
 * backdrop is a real pseudo-element — all of which would otherwise be four
 * things to get right and keep right.
 *
 * `showModal` cannot be expressed as a prop, so an effect drives it. That is
 * what effects are for: this is React telling a browser API what it should be
 * showing, and the guard against calling either method twice is what keeps it
 * from fighting a dialog the user closed with Escape.
 *
 * There is deliberately no click-the-backdrop-to-close. It would be a click
 * handler on an element that is not interactive and has no keyboard
 * equivalent, which is the shape of a control only a mouse can reach. Escape
 * closes it, the button closes it, and both work from a keyboard.
 */
export function SettingsDialog({
  node,
  wiring,
  open,
  onChange,
  onRemove,
  onClose,
}: SettingsDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (element === null) {
      return;
    }
    if (open && !element.open) {
      element.showModal();
    } else if (!open && element.open) {
      element.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialog}
      className="settings"
      aria-label="Component settings"
      // Escape closes the dialog without going through the button, so the page
      // is told here rather than only there. Without it the dialog would be
      // shut and the page would still think it was open, and clicking the same
      // component again would do nothing.
      onClose={onClose}
    >
      <div className="settings__body">
        <Inspector node={node} wiring={wiring} onChange={onChange} onRemove={onRemove} />
        <button type="button" className="settings__done" onClick={onClose}>
          Done
        </button>
      </div>
    </dialog>
  );
}
