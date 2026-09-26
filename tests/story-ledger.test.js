import test from 'node:test';
import assert from 'node:assert/strict';
import { storyCandidates, planWeeklyStories, assertNoUsedStoryRepeated } from '../src/story-ledger.js';

const documents=[
  {path:'members/member-01.md',text:'# Jason\n\n## Approved personal stories and running jokes\n- [story:jason-foam] Jason attended the Program Board foam party.\n- Jason once lost his room key during formal.\n\n## Team history\n- 2025 champion.'},
  {path:'creighton/stories.md',text:'# Community\n\n## Stories\n- The old student center table hosted weekly parliamentary hearings.'}
];

test('story ledger extracts only approved story sections with stable IDs',()=>{
  const stories=storyCandidates(documents);
  assert.equal(stories.length,3);
  assert.ok(stories.some(story=>story.id==='jason-foam'));
  assert.ok(!stories.some(story=>story.text.includes('champion')));
});

test('published story selections are excluded from future weeks and exact reuse is rejected',()=>{
  const used=storyCandidates(documents)[0];
  const plan=planWeeklyStories(documents,[{status:'published',storySelections:[used]}],{season:2026,week:4,count:4});
  assert.ok(!plan.selected.some(story=>story.textHash===used.textHash));
  assert.throws(()=>assertNoUsedStoryRepeated(`Opening. ${used.text} Closing.`,plan.used),/repeated/);
  assert.doesNotThrow(()=>assertNoUsedStoryRepeated('A completely different approved observation.',plan.used));
});



