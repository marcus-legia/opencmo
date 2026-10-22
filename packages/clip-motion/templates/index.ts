/**
 * Motion templates: finished silent clips ported from Opus's MIT remakes (opus-pro/opusclip-video-tools
 * `remakes/opus-5.5`, notice in THIRD_PARTY_NOTICES.md). A model starts from one, edits the `SLOTS` at the top of
 * `code` and its `direction`, and previews it like any scene it wrote. The source of each is
 * `templates/<id>/{template.json,scene.jsx,SPEC.md}`; `index.gen.ts` is generated from them.
 */

import { TEMPLATE_DATA } from './index.gen';

export type MotionTemplateSlot = { name: string; kind: 'text' | 'image' | 'color'; note: string; default?: string };

export type MotionTemplate = {
	id: string;
	title: string;
	description: string;
	kind: 'clip' | 'explainer';
	format: '16:9' | '9:16' | '1:1';
	seconds: number;
	slots: MotionTemplateSlot[];
	/** Each beat's `visual` makes them valid preview_explainer beats as they are. */
	beats: { say: string; label?: string; visual: string; seconds?: number }[];
	/** The SPEC.md text: a valid `direction` for the tools. */
	direction: string;
	/** Scene body for (React, R, kit); slots are read from `const SLOTS = {...}` at the top. */
	code: string;
	source: { repo: string; path: string; license: 'MIT' };
};

export const MOTION_TEMPLATES: readonly MotionTemplate[] = TEMPLATE_DATA as readonly MotionTemplate[];

export const motionTemplate = (id: string): MotionTemplate | undefined => MOTION_TEMPLATES.find((template) => template.id === id);
