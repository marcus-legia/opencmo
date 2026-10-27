"use client";

import { useState } from "react";

import { BrandView } from "@/components/clipping/web/BrandView";

import { Button, PageHeader, Panel, SampleTag, Screen, Tabs, Toggle } from "../kit";
import { useTabParam } from "../useTabParam";
import { BusinessDocs } from "./BusinessDocs";
import { LIBRARY_SAMPLE, WHO_READS, type SkillItem } from "./data";

const TABS = [
  { id: "business", label: "Business · 4 documents" },
  { id: "brand", label: "Brand Kit" },
  { id: "voice", label: "Voice" },
  { id: "skills", label: "Skills" },
] as const;
type Tab = (typeof TABS)[number]["id"];

export function LibraryScreen() {
  const [tab, setTab] = useTabParam<Tab>("tab", TABS.map((t) => t.id), "business");

  return (
    <Screen label="Library">
      <PageHeader
        eyebrow="Library · read by the Brain and every department"
        title="What your team knows about your business."
        sub="One copy of each thing. Change it here and every department uses the new version, including the editor and your own Claude through MCP."
      />
      <Tabs label="Library" tabs={[...TABS]} value={tab} onChange={setTab} />
      <div className="scr-split">
        <div className="scr-main" role="tabpanel" aria-labelledby={`tab-${tab}`}>
          {tab === "business" && <BusinessDocs />}
          {tab === "brand" && (
            // Today's kit editor, restyled by `screens.css`: one editor, so the kit the founder
            // sees here is the kit the editor's `apply_brand` uses.
            <div className="scr-brand-host">
              <BrandView />
            </div>
          )}
          {tab === "voice" && <VoiceTab />}
          {tab === "skills" && <SkillsTab />}
        </div>
        <Panel as="aside" title="Who reads what" className="scr-side">
          <div className="scr-rows">
            {WHO_READS.map((row) => (
              <div key={row.who} className="scr-row">
                <b>{row.who}</b>
                <span className="scr-small scr-muted">{row.what}</span>
              </div>
            ))}
            <div className="scr-row">
              <b>Not here</b>
              <span className="scr-small scr-muted">
                Plans, orders, lessons and rules from edits live in <a href="/app/brain">Brain</a>.
              </span>
            </div>
          </div>
        </Panel>
      </div>
    </Screen>
  );
}

/** Voice notes are learned by the brain (B0 corrections); sample until then. */
function VoiceTab() {
  const [notes, setNotes] = useState(LIBRARY_SAMPLE.voice.notes);
  return (
    <Panel
      tone="white"
      title={<>Voice <SampleTag /></>}
      sub="Learned from your edits; newer notes win when two disagree. Delete any you don't agree with."
      aside={<Button small disabled title="Arrives with the brain's corrections">Add a note</Button>}
    >
      <div className="scr-rows">
        {notes.map((note) => (
          <div key={note.id} className="scr-row scr-row-inline">
            <span>
              <b>{note.text}</b>
              <br />
              <span className="scr-tiny scr-muted">{note.source}</span>
            </span>
            <Button
              small
              variant="quiet"
              aria-label={`Delete note: ${note.text}`}
              onClick={() => setNotes((all) => all.filter((n) => n.id !== note.id))}
            >
              Delete
            </Button>
          </div>
        ))}
        <div className="scr-row">
          <b>Words you always cut</b>
          <span className="scr-cut-words">
            {LIBRARY_SAMPLE.voice.cutWords.map((word) => (
              <s key={word}>{word}</s>
            ))}
          </span>
        </div>
      </div>
    </Panel>
  );
}

function SkillsTab() {
  return (
    <>
      <SkillList title="Writing skills · used by Writer and Sales" items={LIBRARY_SAMPLE.writingSkills} />
      <SkillList title="Video skills · used by Studio and the editor" items={LIBRARY_SAMPLE.videoSkills} />
    </>
  );
}

function SkillList({ title, items }: { title: string; items: SkillItem[] }) {
  const [on, setOn] = useState(() => new Map(items.map((item) => [item.id, item.on])));
  return (
    <Panel tone="white" title={<>{title} <SampleTag /></>}>
      <div className="scr-rows">
        {items.map((item) => (
          <div key={item.id} className="scr-row scr-row-inline">
            <span>
              <b>{item.name}</b>
              <br />
              <span className="scr-tiny scr-muted">{item.source}</span>
            </span>
            <Toggle
              checked={on.get(item.id) ?? false}
              label={item.name}
              onChange={(next) => setOn((map) => new Map(map).set(item.id, next))}
            />
          </div>
        ))}
      </div>
    </Panel>
  );
}
