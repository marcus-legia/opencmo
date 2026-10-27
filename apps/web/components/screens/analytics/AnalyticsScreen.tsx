"use client";

import { PageHeader, Screen, SkeletonBlocks } from "../kit";

export function AnalyticsScreen() {
  return (
    <Screen label="Analytics">
      <PageHeader eyebrow="Analytics" title="Analytics" sample />
      <SkeletonBlocks />
    </Screen>
  );
}
