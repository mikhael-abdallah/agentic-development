"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import { scenarios } from "@/features/simulation/client";
import { type Design, designOf } from "@/lib/design";
import {
  deleteDesign,
  designOfSaved,
  designsSnapshot,
  noSavedDesigns,
  saveDesign,
  subscribeToDesigns,
} from "@/lib/designStore";
import type { Scenario, Topology } from "@/lib/topology";

interface LibraryProps {
  readonly topology: Topology;
  readonly onLoad: (design: Design) => void;
}

/**
 * Three states, not a list and a flag.
 *
 * An empty list before the request has answered is indistinguishable from one
 * after it failed, and the two want opposite things on screen: nothing yet,
 * versus a sentence explaining why the shelf is bare. Saying the engine is
 * unreachable on the first paint of every load is a claim that has not been
 * earned, and one that retracts itself a moment later.
 */
type Presets =
  | { readonly status: "asking" }
  | { readonly status: "ready"; readonly list: Scenario[] }
  | { readonly status: "unreachable" };

/**
 * Where a design comes from, and where it goes.
 *
 * The presets are fetched rather than bundled: a preset is only worth anything
 * if it is the one the simulator will actually run, and the engine refuses to
 * start if any of them stopped validating. A copy in this bundle would be a
 * second answer to what the shortener is.
 */
export function Library({ topology, onLoad }: LibraryProps) {
  const [presets, setPresets] = useState<Presets>({ status: "asking" });
  // Read through useSyncExternalStore rather than copied into state: what is
  // in localStorage can change from another tab, and a copy would go stale
  // without anything noticing.
  const saved = useSyncExternalStore(subscribeToDesigns, designsSnapshot, noSavedDesigns);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    scenarios(controller.signal)
      .then((list) => {
        setPresets({ status: "ready", list });
      })
      .catch(() => {
        setPresets({ status: "unreachable" });
      });
    return () => {
      controller.abort();
    };
  }, []);

  const save = () => {
    const trimmed = name.trim();
    if (trimmed === "") {
      setNote("Give it a name first.");
      return;
    }
    saveDesign(trimmed, topology);
    setNote(`Saved as ${trimmed}.`);
  };

  return (
    <section className="library" aria-label="Designs">
      <h2 className="library__title">Start from</h2>
      <ul className="library__list">
        {presets.status === "ready"
          ? presets.list.map((preset) => (
              <li key={preset.id}>
                <button
                  type="button"
                  className="library__item"
                  onClick={() => {
                    onLoad(designOf(preset));
                    setName(preset.title);
                    setNote(preset.goal);
                  }}
                >
                  <span className="library__name">{preset.title}</span>
                  <span className="library__blurb">{preset.description}</span>
                </button>
              </li>
            ))
          : null}
        {presets.status === "unreachable" ? (
          <li className="field__hint">No presets — the engine could not be reached.</li>
        ) : null}
      </ul>

      <h2 className="library__title">Save this design</h2>
      <div className="library__save">
        <input
          type="text"
          className="field__input"
          aria-label="Design name"
          placeholder="My design"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
        <button type="button" className="library__button" onClick={save}>
          Save
        </button>
      </div>
      <ul className="library__list">
        {saved.map((design) => (
          <li key={design.name} className="library__saved">
            <button
              type="button"
              className="library__item"
              onClick={() => {
                onLoad(designOfSaved(design));
                setName(design.name);
                setNote(`Loaded ${design.name}.`);
              }}
            >
              <span className="library__name">{design.name}</span>
            </button>
            <button
              type="button"
              className="library__button"
              aria-label={`Delete ${design.name}`}
              onClick={() => {
                deleteDesign(design.name);
                setNote(`Deleted ${design.name}.`);
              }}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <p className="field__hint" role="status">
        {note}
      </p>
    </section>
  );
}
