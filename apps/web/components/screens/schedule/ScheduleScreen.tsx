"use client";

import { PageHeader, Screen, SkeletonBlocks } from "../kit";

export function ScheduleScreen() {
  return (
    <Screen label="Schedule">
      <PageHeader eyebrow="Schedule" title="Schedule" sample />
      <SkeletonBlocks />
    </Screen>
  );
}
