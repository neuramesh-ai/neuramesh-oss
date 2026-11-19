// The build rule of intake (round 9): about 60 phrases, the hits and the misses. A miss is cheap (the
// starter brain or the agent still decides), a false hit turns a conversation into a coding thread,
// so the negatives matter as much as the positives.
import { describe, expect, it } from 'vitest';
import { buildRule, diagramAsk, intakeRule, intakeSlug, newBuildAsk } from '../src/intake-rules';
import { intakeBrief, intakePlanView } from '../src/intake-view';
import type { IntakeDecision } from '../src/intake';

const HITS: string[] = [
  'build a palindrome html app that checks if a string is a palindrome',
  'Build a todo app in React',
  'create a landing page for our launch',
  'make a snake game in javascript',
  'implement a rate limiter function in python',
  'fix the login bug',
  'refactor the auth code into smaller functions',
  'add a feature that exports CSV from the dashboard',
  'write a script that renames my photos by date',
  'write a python script to parse this CSV',
  'Can you build me a website for my bakery?',
  'could you make a chrome extension that blocks twitter',
  'please fix the crash on startup',
  'set up a REST API for the orders',
  'scaffold a CLI that converts markdown to html',
  'create a component for the pricing table',
  'build a calculator app',
  'make a unit converter',
  'debug the API endpoint that returns 500',
  'write unit tests for the parser',
  'generate a regex that matches emails',
  'I need a landing page for the beta',
  'we want a mobile app for booking',
  'the login page is broken',
  'the app crashes when I upload a photo',
  'hey, can you create a web app that tracks habits',
  'Build a palindrome checker',
  'code a tic tac toe game',
  'develop a slack bot that posts standups',
  'prototype a dashboard for our sales numbers',
  'let\'s build a small blog site with Svelte',
  '@rex build a weather widget',
];

const MISSES: string[] = [
  'what is a palindrome',
  'explain React hooks',
  'write a blog post about our app',
  'write a LinkedIn post announcing the beta',
  'how do I build a react app?',
  'why does my build fail',
  'what are the best practices for API design',
  'draft three tweets about the launch',
  'create a marketing plan for Q3',
  'make a logo for the bakery',
  'write an email to the investors',
  'summarize this article',
  'tell me about the competitors',
  'create a pitch deck for the seed round',
  'make a diagram of the architecture',
  'write a poem about palindromes',
  'hello',
  'thanks!',
  'what should we work on next?',
  'add it to the backlog',
  'research the best CRM tools for small teams',
  'write a newsletter about our new feature',
  'create a UGC script for TikTok',
  'Can you explain how the sync works?',
  'is the API down?',
  'describe the login flow',
  'make a list of competitors',
  'build a strategy for the launch',
];

describe('buildRule', () => {
  it('hits every clear request to build, change or fix software', () => {
    const missed = HITS.filter((h) => !buildRule(h).hit);
    expect(missed).toEqual([]);
  });

  it('never hits a question, a content ask or a plain conversation', () => {
    const hit = MISSES.filter((m) => buildRule(m).hit);
    expect(hit).toEqual([]);
  });

  it('names the verb and the noun that matched, for the log', () => {
    expect(buildRule('build a palindrome html app')).toEqual({ hit: true, verb: 'build', noun: 'html' });
    expect(buildRule('the login page is broken')).toMatchObject({ hit: true, verb: 'fix' });
    expect(buildRule('I need a landing page')).toMatchObject({ hit: true, verb: 'build', noun: 'landing page' });
  });

  it('reads the first noun after the verb: content first is a content ask', () => {
    expect(buildRule('write a blog post about our app').hit).toBe(false);
    expect(buildRule('write an app that drafts blog posts').hit).toBe(true);
  });

  it('ignores fenced code and markers', () => {
    expect(buildRule('```\nbuild a website\n```\nwhat is this?').hit).toBe(false);
    expect(buildRule('‹skill:frontend› build a landing page').hit).toBe(true);
  });

  it('an empty message decides nothing', () => {
    expect(buildRule('').hit).toBe(false);
    expect(buildRule('   ').hit).toBe(false);
  });
});

describe('intakeRule', () => {
  const repos = [{ id: 'r1', name: 'flowe/app', primary: true }, { id: 'r2', name: 'flowe/docs-site' }];
  it('a miss is null, a new build is scratch, even when the project has a repository', () => {
    expect(intakeRule('what is a palindrome', { repos })).toBeNull();
    expect(intakeRule('build a palindrome html app', { repos })).toEqual({ kind: 'coding', workspace: 'scratch' });
    expect(intakeRule('build a palindrome html app')).toEqual({ kind: 'coding', workspace: 'scratch' });
  });
  it('a change to existing code takes the primary repository, a named repository wins', () => {
    expect(intakeRule('fix the login bug', { repos })).toEqual({ kind: 'coding', workspace: 'repo', repoId: 'r1' });
    expect(intakeRule('build a search page in docs-site', { repos })).toEqual({ kind: 'coding', workspace: 'repo', repoId: 'r2' });
    expect(intakeRule('fix the login bug')).toEqual({ kind: 'coding', workspace: 'scratch' });
  });
});

describe('newBuildAsk and diagramAsk', () => {
  it('a new standalone thing, with no reference to existing code', () => {
    for (const t of ['build a palindrome html app that checks if a string is a palindrome', 'Write a Node.js command line tool that counts words in a text file',
      'Code a landing page for a coffee shop with a menu section and a contact form', 'scaffold a React app with a counter and a reset button',
      'implement fizzbuzz in rust and add a test for it', 'Create a password generator page with length and symbol options',
      'I need a unit converter web page for kilometers and miles', 'make a snake game that runs in the browser']) expect(newBuildAsk(t), t).toBe(true);
  });
  it('not a change to existing code, a content ask, or a fix', () => {
    for (const t of ['make our app load faster', 'create a new settings page in our app', 'write tests for the parser', 'add a login page to the site',
      'review this code: x', 'write a blog post about our app', 'fix the login bug', 'Implement a search box on the products page of acme-web']) expect(newBuildAsk(t), t).toBe(false);
  });
  it('a diagram, a whiteboard or a flowchart', () => {
    expect(diagramAsk('draw a diagram of the signup flow')).toBe(true);
    expect(diagramAsk('Sketch our Q1 roadmap on a whiteboard')).toBe(true);
    expect(diagramAsk('build a palindrome html app')).toBe(false);
  });
});

describe('intakeSlug', () => {
  it('a short kebab-case name, at most 40 characters', () => {
    expect(intakeSlug('Palindrome checker web app')).toBe('palindrome-checker-web-app');
    expect(intakeSlug('build a palindrome html app that checks if a string is a palindrome').length).toBeLessThanOrEqual(40);
    expect(intakeSlug('!!!')).toBe('scratch');
  });
});

const decision = (over: Partial<IntakeDecision> = {}): IntakeDecision => ({
  v: 1, kind: 'coding', confidence: 0.92, title: 'Palindrome checker web app', name: 'palindrome-checker',
  plan: ['Create index.html with an input and a Check button', 'Write the palindrome check in JavaScript', 'Test it in the preview'],
  subtasks: [], workspace: 'scratch', repoId: null, source: 'starter', model: 'gemini-3.5-flash-lite', ms: 900, ...over,
});

describe('intakePlanView and intakeBrief', () => {
  it('the plan line: steps, the workspace, and subtasks only when two or more', () => {
    expect(intakePlanView(decision())).toEqual({ steps: decision().plan, workspace: 'Workspace: scratch', subtasks: null });
    expect(intakePlanView(decision({ workspace: 'repo' }), 'flowe/app').workspace).toBe('Workspace: repo flowe/app');
    expect(intakePlanView(decision({ workspace: 'none' })).workspace).toBeNull();
    const two = intakePlanView(decision({ subtasks: [{ title: 'Design the page', role: 'designer' }, { title: 'Build it', role: 'developer' }] }));
    expect(two.subtasks).toBe('Subtasks: Design the page (designer) · Build it (developer)');
    expect(intakePlanView(decision({ subtasks: [{ title: 'Only one' }] })).subtasks).toBeNull();
  });

  it('the brief carries the kind, the workspace and the numbered plan', () => {
    const b = intakeBrief(decision());
    expect(b).toContain('kind coding');
    expect(b).toContain('workspace: scratch');
    expect(b).toContain('1. Create index.html');
    expect(b).toContain('3. Test it in the preview');
  });
});
