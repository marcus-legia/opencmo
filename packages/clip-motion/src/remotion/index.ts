// Webpack entry of the Remotion bundle (built once per process by render.ts).
import { registerRoot } from 'remotion';

import { Root } from './Root.tsx';

registerRoot(Root);
