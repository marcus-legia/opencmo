"use client";

import { useState } from "react";

import { BrandView } from "@/components/clipping/web/BrandView";

import { Button, SampleTag, Tabs, Toggle } from "@/components/ui";
import type { LibraryScreen as Data } from "@/lib/screens/library";

import { ErrorNote, PageHeader, Panel, Screen, SkeletonBlocks } from "../parts";
import { useTabParam } from "../useTabParam";
import { useScreen, type ScreenState } from "../useScreen";
import { BusinessDocs } from "./BusinessDocs";

type Skill = Data["skills"]["writing"][number];

/** Who reads what: product copy, not data (the frame's side panel). */
const WHO_READS: { who: string; what: string }[] = [
  { who: "Brain", what: "Business, always. Picks the rest into each brief." },
  { who: "Writer", what: "Business · Voice · Writing skills" },
  { who: "Studio and the editor", what: "Business · Brand Kit · Video skills" },
  { who: "Sales", what: "Business · Voice · Writing skills" },
  { who: "Research", what: "Business (competitors list)" },
];

const TABS = [
  { id: "business", label: "Business · 4 documents" },
  { id: "brand", label: "Brand Kit" },
  { id: "voice", label: "Voice" },
  { id: "skills", label: "Skills" },
] as const;
type Tab = (typeof TABS)[number]["id"];

export function LibraryScreen() {
  const [tab, setTab] = useTabParam<Tab>("tab", TABS.map((t) => t.id), "business");
  // Business and Brand Kit read today's routes (they also write through them); Voice and Skills come from the
  // screens route, sample until brain B0.
  const [screen] = useScreen("library");

  return (
    <Screen label="Library">
      <PageHeader
        eyebrow="Library · read by the Brain and every department"
        title="What your team knows about your business."
        sub="One copy of each thing. Change it here and every department uses the new version, including the editor and your own Claude through MCP."
      />
      <Tabs<Tab> label="Library" idBase="library-tab" items={[...TABS]} value={tab} onChange={setTab} />
      <div className="scr-split">
        <div className="scr-main" role="tabpanel" id="library-tab-panel" aria-labelledby={`library-tab-${tab}`}>
          {tab === "business" && <BusinessDocs />}
          {tab === "brand" && (
            // Today's kit editor, restyled by `screens.css`: one editor, so the kit the founder
            // sees here is the kit the editor's `apply_brand` uses.
            <div className="scr-brand-host">
              <BrandView />
            </div>
          )}
          {tab === "voice" && <Gate screen={screen}>{(data, sample) => <VoiceTab voice={data.voice} sample={sample} />}</Gate>}
          {tab === "skills" && <Gate screen={screen}>{(data, sample) => <SkillsTab skills={data.skills} sample={sample} />}</Gate>}
        </div>
        <Panel id="library-who-reads-what" title="Who reads what" className="scr-side">
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

function Gate({
  screen,
  children,
}: {
  screen: ScreenState<"library">;
  children: (data: Data, sample: { voice: boolean; skills: boolean }) => React.ReactNode;
}) {
  if (screen.status === "loading") return <SkeletonBlocks rows={2} />;
  if (screen.status === "error") return <ErrorNote>{screen.message}</ErrorNote>;
  return <>{children(screen.data, { voice: !screen.live.voice, skills: !screen.live.skills })}</>;
}

/** Voice notes are learned by the brain (B0 corrections). Delete only hides the row until that RPC exists. */
function VoiceTab({ voice, sample }: { voice: Data["voice"]; sample: { voice: boolean } }) {
  const [notes, setNotes] = useState(voice.notes);
  return (
    <Panel id="library-voice"
      white
      title={<>Voice {sample.voice && <SampleTag />}</>}
      sub="Learned from your edits; newer notes win when two disagree. Delete any you don't agree with."
      actions={
        <Button compact disabled title="Notes are added from your edits for now">
          Add a note
        </Button>
      }
    >
      <div className="scr-rows">
        {notes.length === 0 && <p className="scr-row scr-muted">No notes yet. Writer learns them from what you change in its drafts.</p>}
        {notes.map((note) => (
          <div key={note.id} className="scr-row scr-row-inline">
            <span>
              <b>{note.text}</b>
              <br />
              <span className="scr-tiny scr-muted">
                {note.source}
                {note.replaces ? ` · replaces an older note “${note.replaces}”` : ""}
              </span>
            </span>
            <Button
              compact
              variant="quiet"
              aria-label={`Delete note: ${note.text}`}
              onClick={() => setNotes((all) => all.filter((n) => n.id !== note.id))}
            >
              Delete
            </Button>
          </div>
        ))}
        {voice.wordsCut.length > 0 && (
          <div className="scr-row">
            <b>Words you always cut</b>
            <span className="scr-cut-words">
              {voice.wordsCut.map((word) => (
                <s key={word}>{word}</s>
              ))}
            </span>
          </div>
        )}
      </div>
    </Panel>
  );
}

function SkillsTab({ skills, sample }: { skills: Data["skills"]; sample: { skills: boolean } }) {
  return (
    <>
      <SkillList id="library-writing-skills" title="Writing skills · used by Writer and Sales" items={skills.writing} sample={sample.skills} />
      <SkillList id="library-video-skills" title="Video skills · used by Studio and the editor" items={skills.video} sample={sample.skills} />
    </>
  );
}

function SkillList({ id, title, items, sample }: { id: string; title: string; items: Skill[]; sample: boolean }) {
  const [on, setOn] = useState(() => new Map(items.map((item) => [item.id, item.enabled])));
  return (
    <Panel id={id} white title={<>{title} {sample && <SampleTag />}</>}>
      <div className="scr-rows">
        {items.length === 0 && <p className="scr-row scr-muted">None yet. Ask the editor Assistant to remember a recipe and it shows here.</p>}
        {items.map((item) => (
          <div key={item.id} className="scr-row scr-row-inline">
            <span>
              <b>{item.name}</b>
              <br />
              <span className="scr-tiny scr-muted">{item.note}</span>
            </span>
            <Toggle checked={on.get(item.id) ?? false} onChange={(next) => setOn((map) => new Map(map).set(item.id, next))}>
              <span className="scr-sr-only">{item.name}</span>
            </Toggle>
          </div>
        ))}
      </div>
    </Panel>
  );
}
