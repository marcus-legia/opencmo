"use client";

import { PageHeader, Screen, SkeletonBlocks } from "../kit";

export function StudioScreen() {
  return (
    <Screen label="Studio">
      <PageHeader eyebrow="Studio" title="Studio" sample />
      <SkeletonBlocks />
    </Screen>
  );
}
