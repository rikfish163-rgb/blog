import { describe, expect, it } from 'vitest';
import { PROFILE } from '../src/site.config';

const serialized = JSON.stringify(PROFILE);

describe('public profile data', () => {
  it('does not publish the private phone number or legacy QQ mailbox', () => {
    expect(serialized).not.toContain('13697249193');
    expect(serialized).not.toContain('2789428639@qq.com');
  });

  it('contains no unfinished copy placeholders', () => {
    expect(serialized).not.toMatch(/待填|TODO/i);
  });

  it('links every featured project to a public HTTPS GitHub page', () => {
    expect(PROFILE.projects.length).toBeGreaterThanOrEqual(3);
    for (const project of PROFILE.projects) {
      expect(project.link).toMatch(/^https:\/\/github\.com\/rikfish163-rgb\//);
    }
  });

  it('keeps resume sections bilingual', () => {
    const localized = [
      PROFILE.intro,
      ...PROFILE.education.flatMap((entry) => [entry.school, entry.degree, entry.note]),
      ...PROFILE.projects.flatMap((entry) => [entry.name, entry.role, entry.summary]),
      ...PROFILE.organizations.flatMap((entry) => [entry.name, entry.role]),
      ...PROFILE.honors.map((entry) => entry.title),
      ...PROFILE.competitions.map((entry) => entry.name),
      ...PROFILE.skills.map((entry) => entry.group),
      PROFILE.looking,
    ];

    for (const value of localized) {
      expect(value.zh.trim()).not.toBe('');
      expect(value.en.trim()).not.toBe('');
    }
  });
});
