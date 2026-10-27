"use client";

import { PageHeader, Screen, SkeletonBlocks } from "../kit";

export function SalesScreen() {
  return (
    <Screen label="Sales">
      <PageHeader eyebrow="Sales" title="Sales" sample />
      <SkeletonBlocks />
    </Screen>
  );
}
