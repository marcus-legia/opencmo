"use client";

import { useState } from "react";

import {
  Button,
  Chip,
  EmptyState,
  Field,
  Kpi,
  KpiStrip,
  MonoLabel,
  Panel,
  SampleTag,
  Segmented,
  SelectField,
  Sparkline,
  Tabs,
  TextareaField,
  Toggle,
} from "@/components/ui";

const COLOURS: [string, string, string][] = [
  ["paper", "--v2-paper", "#f3f3ee · ground"],
  ["paper2", "--v2-paper2", "#fafaf8 · panels"],
  ["paper3", "--v2-paper3", "#e8e8de · wash, idle"],
  ["ink", "--v2-ink", "#2b2723 · text, running"],
  ["ink2", "--v2-ink2", "#69695d · labels 5.0:1"],
  ["line", "--v2-line", "#d6d6c9 · rules; line2 #b9b9aa"],
  ["char", "--v2-char", "#26282c · Brain, media"],
  ["brand", "--v2-brand", "#ef4a1a · marks only"],
  ["brand-deep", "--v2-brand-deep", "#c93a0f · buttons, links"],
  ["brand-soft", "--v2-brand-soft", "#ffd8c6 · waiting on you"],
  ["waiting text", "--v2-waiting", "#a9420f on soft"],
  ["ok", "--v2-ok", "#2b7550 on #e6f1eb"],
  ["stuck", "--v2-stuck", "#b23a2e on #fbeeea"],
  ["card", "--v2-card", "#ffffff · approval cards"],
];

export function DesignSheet() {
  const [tab, setTab] = useState<"business" | "brand" | "voice">("business");
  const [range, setRange] = useState<"7" | "30" | "90">("7");
  const [on, setOn] = useState(true);

  return (
    <div className="v2-design" data-testid="v2-design">
      <header style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 900 }}>
        <MonoLabel muted mark>Landing v4 tokens, used in the app</MonoLabel>
        <h1 className="v2-title">Paper, ink and one brand orange.</h1>
        <p style={{ fontSize: 16 }} className="v2-muted">
          Flat surfaces, thin rules, square corners, pill buttons. The orange is a mark, not a text colour: text and
          filled buttons use the deep orange so they pass 4.5:1.
        </p>
      </header>

      <section aria-label="Colours" className="v2-swatches">
        {COLOURS.map(([name, token, note]) => (
          <div key={name} className="v2-swatch">
            <span style={{ background: `var(${token})` }} />
            <b>{name}</b>
            <span className="v2-num v2-muted" style={{ fontSize: 12 }}>{note}</span>
          </div>
        ))}
      </section>

      <section aria-label="Type" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <MonoLabel muted>Type · Inter + Source Code Pro</MonoLabel>
        <span className="v2-title">Page title 44 / 500</span>
        <span className="v2-figure">Figure 22 / 500</span>
        <span style={{ fontSize: 17, fontWeight: 500 }}>Card title 17 / 500</span>
        <span>Body 14 / 400, line height 1.5. Copy describes software: drafts you approve and publish.</span>
        <MonoLabel>Label 11–12 mono, uppercase, 0.12em</MonoLabel>
        <span className="v2-numeral">I II III IV V VI · department numerals</span>
      </section>

      <section aria-label="Buttons" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <MonoLabel muted>Buttons</MonoLabel>
        <div className="v2-design-row">
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="quiet">Quiet</Button>
          <Button variant="danger">Pause CMO</Button>
          <Button variant="on-dark">On dark</Button>
        </div>
        <div className="v2-design-row">
          <Button variant="primary" compact>Approve</Button>
          <Button variant="secondary" compact>Edit</Button>
          <Button variant="quiet" compact>Skip with reason</Button>
          <Button variant="primary" disabled title="Arrives with Studio cards">Disabled</Button>
        </div>
      </section>

      <section aria-label="Chips" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <MonoLabel muted>Chips</MonoLabel>
        <div className="v2-design-row">
          <Chip tone="running">Running</Chip>
          <Chip tone="waiting">Waiting on you</Chip>
          <Chip tone="stuck">Stuck</Chip>
          <Chip tone="posted">Posted</Chip>
          <Chip tone="scheduled">Scheduled</Chip>
          <Chip tone="idle">Idle</Chip>
          <SampleTag />
        </div>
      </section>

      <section aria-label="Tabs and segmented" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <MonoLabel muted>Tabs · Segmented</MonoLabel>
        <Tabs
          label="Library"
          idBase="design-tabs"
          value={tab}
          onChange={setTab}
          items={[
            { id: "business", label: "Business" },
            { id: "brand", label: "Brand Kit" },
            { id: "voice", label: "Voice" },
          ]}
        />
        <div id="design-tabs-panel" role="tabpanel" aria-labelledby={`design-tabs-${tab}`} className="v2-muted">
          Selected: {tab}
        </div>
        <Segmented
          label="Range"
          value={range}
          onChange={setRange}
          items={[
            { id: "7", label: "7 days" },
            { id: "30", label: "30 days" },
            { id: "90", label: "90 days" },
          ]}
        />
      </section>

      <KpiStrip label="KPIs">
        <Kpi label="Week goal" value="Launch the editor" text progress={64} />
        <Kpi label="Deliverables done" value="9 / 14" />
        <Kpi label="Impressions" value="14.2k" delta={{ label: "+18%", direction: "up" }} />
        <Kpi label="Clicks" value="212" delta={{ label: "−4%", direction: "down" }} />
        <Kpi label="Followers" value={null} delta={{ label: "not reported", direction: "flat" }} />
      </KpiStrip>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(360px, 100%), 1fr))", gap: 24, alignItems: "start" }}>
        <Panel id="design-panel" title="Results · last 7 days" sample link={{ href: "/app/analytics", label: "Analytics" }}>
          <div className="v2-panel-body" style={{ display: "flex", gap: 16, alignItems: "center" }}>
            <Sparkline label="Rising" values={[30, 45, 40, 60, 100, 70, 85]} />
            <Sparkline label="Spiky" tone="brand" values={[15, 100, 35, 20, 80, 30, 25]} />
            <Sparkline label="Flat" tone="flat" values={[40, 50, 45, 40, 55, 50, 45]} />
          </div>
          <div className="v2-panel-foot">
            <span className="v2-mark" aria-hidden="true" />
            <span><b>Brain used this:</b> 3 lessons for next week.</span>
          </div>
        </Panel>

        <section aria-label="Fields" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Field label="Input" defaultValue="opencmo.io" />
          <Field label="With an error" defaultValue="not a url" error="Enter a website, like opencmo.io." />
          <SelectField label="Time zone" defaultValue="Asia/Ho_Chi_Minh">
            <option>Asia/Ho_Chi_Minh</option>
            <option>Europe/London</option>
          </SelectField>
          <TextareaField label="Textarea" hint="Shown to the Writer before every draft." defaultValue="No question openers." />
          <Toggle checked={on} onChange={setOn}>Morning email</Toggle>
          <Toggle checked={false} onChange={() => undefined} disabled title="Arrives with the off switch">Disabled toggle</Toggle>
        </section>
      </div>

      <EmptyState title="Nothing waits on you.">Your team keeps working. The next card lands here and in the morning email.</EmptyState>
    </div>
  );
}
