"use client";

import { PageHeader, Screen, SkeletonBlocks } from "../kit";

export function SettingsScreen({ mcpEndpoint, paid }: { mcpEndpoint: string | null; paid: boolean }) {
  void mcpEndpoint;
  void paid;
  return (
    <Screen label="Settings">
      <PageHeader eyebrow="Settings" title="Accounts, budget, and the off switch." sample />
      <SkeletonBlocks />
    </Screen>
  );
}
