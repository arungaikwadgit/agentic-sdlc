/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
/**
 * Traceability Matrix Export (Appendix O).
 * Links User Story IDs → Test Case IDs → Functional Requirement IDs.
 * Parses markdown output from userStory, testCases, and manager agents.
 */

import Papa from 'papaparse';
import { saveAs } from 'file-saver';
import { getProject } from '@/db/projectRepository';

interface TraceRow {
  storyId: string;
  storyTitle: string;
  requirementRef: string;
  testCaseId: string;
  testCaseTitle: string;
  priority: string;
}

/**
 * Extract US-xxx IDs and titles from userStory markdown output.
 */
function parseStories(markdown: string): Array<{ id: string; title: string }> {
  const stories: Array<{ id: string; title: string }> = [];
  const lines = markdown.split('\n');
  let counter = 1;

  for (const line of lines) {
    // Match lines like "As a [persona]..." or "**US-001**" patterns
    const usMatch = line.match(/US-(\d{3})/i);
    if (usMatch) {
      const title = line.replace(/^[#*\-\s]+/, '').trim().slice(0, 80);
      stories.push({ id: `US-${usMatch[1]}`, title });
    } else if (/^[-*]\s+As a /i.test(line)) {
      const id = `US-${String(counter).padStart(3, '0')}`;
      const title = line.replace(/^[-*\s]+/, '').trim().slice(0, 80);
      stories.push({ id, title });
      counter++;
    }
  }

  // Deduplicate by id
  return stories.filter((s, i, arr) => arr.findIndex((x) => x.id === s.id) === i);
}

/**
 * Extract TC-xxx IDs and titles from testCases markdown output.
 */
function parseTestCases(markdown: string): Array<{ id: string; title: string; relatedStoryId?: string }> {
  const tests: Array<{ id: string; title: string; relatedStoryId?: string }> = [];
  const lines = markdown.split('\n');
  let counter = 1;

  for (const line of lines) {
    const tcMatch = line.match(/TC-(\d{3})/i);
    const storyRef = line.match(/US-(\d{3})/i);

    if (tcMatch) {
      const title = line.replace(/^[#*\-\s]+/, '').trim().slice(0, 80);
      tests.push({
        id: `TC-${tcMatch[1]}`,
        title,
        relatedStoryId: storyRef ? `US-${storyRef[1]}` : undefined,
      });
    } else if (/^\|?\s*TC-/i.test(line) === false && /test case/i.test(line) && counter <= 50) {
      const id = `TC-${String(counter).padStart(3, '0')}`;
      const title = line.replace(/^[-*|\s]+/, '').trim().slice(0, 80);
      if (title.length > 5) {
        tests.push({ id, title, relatedStoryId: storyRef ? `US-${storyRef[1]}` : undefined });
        counter++;
      }
    }
  }

  return tests.filter((t, i, arr) => arr.findIndex((x) => x.id === t.id) === i);
}

/**
 * Extract FR-xxx requirement references from PRD/manager output.
 */
function parseRequirements(markdown: string): Array<{ id: string; title: string }> {
  const reqs: Array<{ id: string; title: string }> = [];
  const lines = markdown.split('\n');
  let counter = 1;

  for (const line of lines) {
    const frMatch = line.match(/FR-(\d{3})/i);
    if (frMatch) {
      const title = line.replace(/^[#*\-\s]+/, '').trim().slice(0, 80);
      reqs.push({ id: `FR-${frMatch[1]}`, title });
    } else if (/^\d+\.\s/.test(line) && /require|shall|must|should/i.test(line)) {
      const id = `FR-${String(counter).padStart(3, '0')}`;
      const title = line.replace(/^\d+\.\s/, '').trim().slice(0, 80);
      reqs.push({ id, title });
      counter++;
    }
  }

  return reqs.filter((r, i, arr) => arr.findIndex((x) => x.id === r.id) === i).slice(0, 100);
}

export async function generateTraceabilityMatrix(projectId: string): Promise<string> {
  const project = await getProject(projectId);
  if (!project) throw new Error('Project not found');

  const storyOutput = project.agentRuns['userStory']?.output ?? '';
  const testOutput = project.agentRuns['testCases']?.output ?? '';
  const prdOutput = project.agentRuns['manager']?.output ?? '';

  const stories = parseStories(storyOutput);
  const testCases = parseTestCases(testOutput);
  const requirements = parseRequirements(prdOutput);

  const rows: TraceRow[] = [];

  if (stories.length === 0 && testCases.length === 0) {
    // Fallback: generate a placeholder matrix
    rows.push({
      storyId: 'US-001',
      storyTitle: 'Pipeline not yet complete — run agents first',
      requirementRef: 'FR-001',
      testCaseId: 'TC-001',
      testCaseTitle: 'Pending',
      priority: 'P1',
    });
  } else {
    // Link each story to its test cases
    for (const story of stories) {
      const linkedTests = testCases.filter(
        (tc) => tc.relatedStoryId === story.id || !tc.relatedStoryId
      ).slice(0, 3);

      const linkedReq = requirements.find((r) =>
        r.title.toLowerCase().includes(story.title.toLowerCase().split(' ')[0])
      );

      if (linkedTests.length === 0) {
        rows.push({
          storyId: story.id,
          storyTitle: story.title,
          requirementRef: linkedReq?.id ?? 'FR-???',
          testCaseId: '—',
          testCaseTitle: 'No test case linked',
          priority: 'P2',
        });
      } else {
        for (const tc of linkedTests) {
          rows.push({
            storyId: story.id,
            storyTitle: story.title,
            requirementRef: linkedReq?.id ?? 'FR-???',
            testCaseId: tc.id,
            testCaseTitle: tc.title,
            priority: 'P1',
          });
        }
      }
    }
  }

  return Papa.unparse(rows, { header: true });
}

export async function exportTraceabilityCSV(projectId: string, projectName: string) {
  const csv = await generateTraceabilityMatrix(projectId);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  saveAs(blob, `traceability-${projectName.replace(/[^a-z0-9]/gi, '_')}.csv`);
}
