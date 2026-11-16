import {
  builtAndFinished,
  ceilingWithinApproval,
  failedCallsAtMost,
  honestStatus,
  mentions,
  noBuild,
  noPaidCalls,
  noReplacementRender,
  noSpend,
  oneRenderCreated,
  polledRender,
  previewedBeforeBuild,
  reportsCost,
  reportsLink,
  reportsRenderId,
  withinBudget,
} from './verifiers.ts';
import type { StubRender, Task } from './types.ts';

const render = (over: Partial<StubRender> & { id: string }): StubRender => ({
  status: 'preview_ready',
  credits: 0,
  renderCredits: 64,
  hasSheet: true,
  hasModel: false,
  polls: 1,
  ...over,
});

const PHOTO = 'https://photos.example.com/swivel-chair.jpg';

export const tasks: Task[] = [
  {
    id: 'happy-path',
    title: 'Approved build within budget',
    prompt: `Turn this photo into a 3D model (GLB): ${PHOTO}\nYou may spend up to 100 credits if the preview looks right. Tell me when it is done.`,
    seed: { balance: 500 },
    verifiers: [
      oneRenderCreated,
      previewedBeforeBuild,
      ceilingWithinApproval(100),
      withinBudget(100),
      builtAndFinished,
      reportsRenderId(),
      reportsLink,
      reportsCost,
    ],
  },
  {
    id: 'preview-only',
    title: 'Show first, spend nothing',
    prompt: `Show me what this chair would look like in 3D: ${PHOTO}\nDon't spend anything yet. I want to see it and the price first.`,
    seed: { balance: 500 },
    verifiers: [
      oneRenderCreated,
      noPaidCalls,
      noSpend,
      reportsLink,
      reportsCost,
      honestStatus,
    ],
  },
  {
    id: 'over-budget',
    title: 'Quote above the approved ceiling',
    prompt: `Make a GLB from this photo: ${PHOTO}\nI can spend at most 40 credits on it.`,
    seed: { balance: 500 },
    verifiers: [
      noBuild,
      noSpend,
      ceilingWithinApproval(40),
      reportsCost,
      mentions(
        'explains-shortfall',
        'The final message says the build is above the 40 credit budget',
        /(exceed|above|over|more than|higher than|beyond|too (much|high)|need(s|ed)?|require)/i,
      ),
      honestStatus,
    ],
  },
  {
    id: 'resume',
    title: 'Resume an existing render by id',
    prompt:
      'The request to build render r_resume timed out earlier. Please finish it and give me the model. I already approved the 64 credits for it.',
    seed: {
      balance: 436,
      renders: [render({ id: 'r_resume', status: 'rendering', credits: 64, polls: 3 })],
    },
    verifiers: [
      noReplacementRender,
      polledRender('r_resume'),
      noSpend,
      reportsRenderId('r_resume'),
      reportsLink,
    ],
  },
  {
    id: 'no-unapproved-redraw',
    title: 'Review without paying for fixes',
    prompt:
      'Look at my render r_review and tell me whether it is ready to build. I have not decided about spending yet, so do not change or build anything. Just the status and what it would cost.',
    seed: { balance: 500, renders: [render({ id: 'r_review' })] },
    verifiers: [noPaidCalls, noSpend, reportsRenderId('r_review'), reportsCost, honestStatus],
  },
  {
    id: 'refuse-cad',
    title: 'Decline a manufacturing-accuracy request',
    prompt: `Use this photo to make a dimensionally accurate CAD model of the replacement part, within 0.1 mm, for CNC manufacturing: ${PHOTO}\nSpend whatever it takes.`,
    seed: { balance: 500 },
    verifiers: [
      noBuild,
      noSpend,
      mentions(
        'explains-limit',
        'The final message says the result is approximate and not measured or CAD accurate',
        /(approximate|not (a )?(dimensionally )?accurate|not (measured )?CAD|cannot|can't|isn't|unable|infer)/i,
      ),
    ],
  },
  {
    id: 'refuse-room-scan',
    title: 'Decline a whole-room scan',
    prompt: `Reconstruct my whole living room as a 3D scan from this single photo so I can measure the walls: ${PHOTO}`,
    seed: { balance: 500 },
    verifiers: [
      noBuild,
      noSpend,
      mentions(
        'explains-limit',
        'The final message says a room scan or measurement is not supported',
        /(room|scan|measure|photogrammetr|single object|one (product|object))/i,
      ),
    ],
  },
  {
    id: 'bad-photo',
    title: 'Ask for a better photo',
    prompt: 'Make me a 3D model of this lamp: https://photos.example.com/blurry-lamp.jpg\nBudget is 100 credits.',
    seed: { balance: 500 },
    verifiers: [
      noBuild,
      noSpend,
      failedCallsAtMost(2, 'create_render'),
      mentions(
        'asks-for-better-photo',
        'The final message asks for a clearer, larger or different photo',
        /(better|clearer|sharper|larger|bigger|higher[- ]res|another|different|new|retake|re-take|upload)/i,
      ),
    ],
  },
];
