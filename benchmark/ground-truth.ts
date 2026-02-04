/**
 * dpth Gauntlet — Ground Truth Generator
 * 
 * Generates a synthetic dataset of entities spread across multiple sources
 * with KNOWN true identities. Used to benchmark entity resolution accuracy.
 * 
 * Each entity has a `truthId` — the real identity. The gauntlet tests whether
 * dpth can figure out which records share a truthId.
 * 
 * Levels:
 *   1. Gimmes — exact email matches, identical names
 *   2. Normalization — name variants, email casing, company suffixes
 *   3. Ambiguity — generic domains, common names, no shared email
 *   4. Traps — same username different people, shared team emails
 *   5. Topology — 5+ sources, merge chains, job changes
 */

// ── Types ───────────────────────────────────────────

export interface SourceRecord {
  /** Unique ID within this source */
  sourceRecordId: string;
  /** Which source this came from */
  source: string;
  /** Entity type */
  type: 'person' | 'company';
  /** Display name as it appears in this source */
  name: string;
  /** Email if available */
  email?: string;
  /** Username if available */
  username?: string;
  /** Company/org affiliation */
  company?: string;
  /** Additional attributes */
  attributes?: Record<string, string>;
  /** GROUND TRUTH: the real identity (hidden from the resolver) */
  truthId: string;
  /** Which gauntlet level this record belongs to */
  level: number;
}

export interface GauntletDataset {
  records: SourceRecord[];
  /** Number of true unique entities */
  uniqueEntities: number;
  /** Records per level */
  levelCounts: Record<number, number>;
  /** Expected merges (pairs of records that should merge) */
  expectedMerges: Array<[string, string]>;
}

// ── Data pools ──────────────────────────────────────

const SOURCES = ['stripe', 'github', 'hubspot', 'salesforce', 'slack', 'shopify'];

const FIRST_NAMES = [
  'James', 'Mary', 'Robert', 'Patricia', 'John', 'Jennifer', 'Michael', 'Linda',
  'David', 'Elizabeth', 'William', 'Barbara', 'Richard', 'Susan', 'Joseph', 'Jessica',
  'Thomas', 'Sarah', 'Christopher', 'Karen', 'Daniel', 'Lisa', 'Matthew', 'Nancy',
  'Anthony', 'Betty', 'Mark', 'Margaret', 'Steven', 'Sandra', 'Paul', 'Ashley',
  'Andrew', 'Dorothy', 'Joshua', 'Kimberly', 'Kenneth', 'Emily', 'Kevin', 'Donna',
];

const LAST_NAMES = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis',
  'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson',
  'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson',
  'White', 'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson',
];

const COMPANY_NAMES = [
  'Acme', 'Mercury', 'Atlas', 'Bolt', 'Nova', 'Apex', 'Zenith', 'Horizon',
  'Vertex', 'Summit', 'Forge', 'Pulse', 'Catalyst', 'Nexus', 'Spark',
  'Quantum', 'Stellar', 'Orbit', 'Prism', 'Vector',
];

const COMPANY_SUFFIXES = ['Inc', 'Corp', 'LLC', 'Ltd', 'Co', 'Technologies', 'Labs', 'Systems', 'Solutions', 'Group'];

const GENERIC_DOMAINS = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com'];
const CORPORATE_DOMAINS = COMPANY_NAMES.map(c => `${c.toLowerCase()}.com`);

const NICKNAMES: Record<string, string[]> = {
  'Robert': ['Bob', 'Rob', 'Bobby', 'Robbie'],
  'William': ['Will', 'Bill', 'Billy', 'Willy'],
  'Richard': ['Rich', 'Rick', 'Dick', 'Richie'],
  'James': ['Jim', 'Jimmy', 'Jamie'],
  'Michael': ['Mike', 'Mikey'],
  'Joseph': ['Joe', 'Joey'],
  'Thomas': ['Tom', 'Tommy'],
  'Christopher': ['Chris'],
  'Matthew': ['Matt'],
  'Daniel': ['Dan', 'Danny'],
  'Jennifer': ['Jen', 'Jenny'],
  'Elizabeth': ['Liz', 'Beth', 'Lizzy'],
  'Patricia': ['Pat', 'Patty', 'Tricia'],
  'Margaret': ['Maggie', 'Meg', 'Peggy'],
  'Katherine': ['Kate', 'Katie', 'Kathy'],
};

// ── Helpers ─────────────────────────────────────────

let recordCounter = 0;

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickN<T>(arr: T[], n: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

function makeId(prefix: string): string {
  return `${prefix}_${(++recordCounter).toString().padStart(4, '0')}`;
}

function makeUsername(first: string, last: string): string {
  const styles = [
    () => `${first.toLowerCase()}${last.toLowerCase()}`,
    () => `${first[0].toLowerCase()}${last.toLowerCase()}`,
    () => `${first.toLowerCase()}.${last.toLowerCase()}`,
    () => `${first.toLowerCase()}_${last.toLowerCase()}`,
    () => `${first.toLowerCase()}${last[0].toLowerCase()}`,
    () => `${first.toLowerCase()}${Math.floor(Math.random() * 99)}`,
  ];
  return pick(styles)();
}

function makeEmail(first: string, last: string, domain: string): string {
  const styles = [
    () => `${first.toLowerCase()}.${last.toLowerCase()}@${domain}`,
    () => `${first.toLowerCase()}${last.toLowerCase()}@${domain}`,
    () => `${first[0].toLowerCase()}${last.toLowerCase()}@${domain}`,
    () => `${first.toLowerCase()}@${domain}`,
  ];
  return pick(styles)();
}

// ── Level Generators ────────────────────────────────

function generateLevel1(records: SourceRecord[], merges: Array<[string, string]>): number {
  // Level 1: Gimmes — exact email, identical names across 2 sources
  let count = 0;
  for (let i = 0; i < 40; i++) {
    const truthId = `truth_L1_${i}`;
    const first = pick(FIRST_NAMES);
    const last = pick(LAST_NAMES);
    const domain = pick(CORPORATE_DOMAINS);
    const email = makeEmail(first, last, domain);
    const name = `${first} ${last}`;
    const [src1, src2] = pickN(SOURCES, 2);

    const r1: SourceRecord = {
      sourceRecordId: makeId(src1),
      source: src1,
      type: 'person',
      name,
      email,
      truthId,
      level: 1,
    };
    const r2: SourceRecord = {
      sourceRecordId: makeId(src2),
      source: src2,
      type: 'person',
      name,
      email,
      truthId,
      level: 1,
    };
    records.push(r1, r2);
    merges.push([r1.sourceRecordId, r2.sourceRecordId]);
    count += 2;
  }
  return count;
}

function generateLevel2(records: SourceRecord[], merges: Array<[string, string]>): number {
  // Level 2: Normalization — nickname variants, email casing, company suffixes
  let count = 0;

  // Person name variants
  const nicknameNames = Object.keys(NICKNAMES);
  for (let i = 0; i < 25; i++) {
    const truthId = `truth_L2_person_${i}`;
    const first = pick(nicknameNames);
    const nickname = pick(NICKNAMES[first]!);
    const last = pick(LAST_NAMES);
    const domain = pick(CORPORATE_DOMAINS);
    const email = makeEmail(first, last, domain);
    const [src1, src2] = pickN(SOURCES, 2);

    const r1: SourceRecord = {
      sourceRecordId: makeId(src1),
      source: src1,
      type: 'person',
      name: `${first} ${last}`,
      email,
      truthId,
      level: 2,
    };
    const r2: SourceRecord = {
      sourceRecordId: makeId(src2),
      source: src2,
      type: 'person',
      name: `${nickname} ${last}`,
      email: email.toUpperCase(), // Casing variant
      truthId,
      level: 2,
    };
    records.push(r1, r2);
    merges.push([r1.sourceRecordId, r2.sourceRecordId]);
    count += 2;
  }

  // Company name variants
  for (let i = 0; i < 15; i++) {
    const truthId = `truth_L2_company_${i}`;
    const base = pick(COMPANY_NAMES);
    const suffix1 = pick(COMPANY_SUFFIXES);
    const suffix2 = pick(COMPANY_SUFFIXES.filter(s => s !== suffix1));
    const [src1, src2] = pickN(SOURCES, 2);
    const domain = `${base.toLowerCase()}.com`;

    const r1: SourceRecord = {
      sourceRecordId: makeId(src1),
      source: src1,
      type: 'company',
      name: `${base} ${suffix1}`,
      attributes: { domain },
      truthId,
      level: 2,
    };
    const r2: SourceRecord = {
      sourceRecordId: makeId(src2),
      source: src2,
      type: 'company',
      name: `${base.toUpperCase()} ${suffix2}`,
      attributes: { domain },
      truthId,
      level: 2,
    };
    records.push(r1, r2);
    merges.push([r1.sourceRecordId, r2.sourceRecordId]);
    count += 2;
  }

  return count;
}

function generateLevel3(records: SourceRecord[], merges: Array<[string, string]>): number {
  // Level 3: Ambiguity — generic domains, common names, some WITHOUT shared email
  let count = 0;

  // Same person, generic domain, slightly different name
  for (let i = 0; i < 20; i++) {
    const truthId = `truth_L3_match_${i}`;
    const first = pick(FIRST_NAMES);
    const last = pick(LAST_NAMES);
    const domain = pick(GENERIC_DOMAINS);
    const email = makeEmail(first, last, domain);
    const [src1, src2] = pickN(SOURCES, 2);

    const r1: SourceRecord = {
      sourceRecordId: makeId(src1),
      source: src1,
      type: 'person',
      name: `${first} ${last}`,
      email,
      truthId,
      level: 3,
    };
    const r2: SourceRecord = {
      sourceRecordId: makeId(src2),
      source: src2,
      type: 'person',
      name: `${first[0]}. ${last}`,  // Abbreviated first name
      email,
      truthId,
      level: 3,
    };
    records.push(r1, r2);
    merges.push([r1.sourceRecordId, r2.sourceRecordId]);
    count += 2;
  }

  // Different people, same common name, different emails (should NOT merge)
  for (let i = 0; i < 15; i++) {
    const first = pick(['John', 'James', 'Mary', 'David', 'Michael']);
    const last = pick(['Smith', 'Johnson', 'Williams', 'Brown', 'Jones']);
    const [src1, src2] = pickN(SOURCES, 2);

    const r1: SourceRecord = {
      sourceRecordId: makeId(src1),
      source: src1,
      type: 'person',
      name: `${first} ${last}`,
      email: `${first.toLowerCase()}.${last.toLowerCase()}${i}@${pick(GENERIC_DOMAINS)}`,
      truthId: `truth_L3_nomatch_A_${i}`, // Different truth IDs = different people
      level: 3,
    };
    const r2: SourceRecord = {
      sourceRecordId: makeId(src2),
      source: src2,
      type: 'person',
      name: `${first} ${last}`,
      email: `${first.toLowerCase()}${last.toLowerCase()}${i + 100}@${pick(GENERIC_DOMAINS)}`,
      truthId: `truth_L3_nomatch_B_${i}`, // Different truth ID!
      level: 3,
    };
    records.push(r1, r2);
    // NO merge added — these should NOT merge
    count += 2;
  }

  return count;
}

function generateLevel4(records: SourceRecord[], merges: Array<[string, string]>): number {
  // Level 4: Traps — same username different people, shared team emails, look-alikes
  let count = 0;

  // Same username, different people
  for (let i = 0; i < 10; i++) {
    const username = pick(['jsmith', 'admin', 'dev', 'mwilson', 'jdoe', 'user1', 'test', 'alex']);
    const [src1, src2] = pickN(SOURCES, 2);

    const r1: SourceRecord = {
      sourceRecordId: makeId(src1),
      source: src1,
      type: 'person',
      name: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
      username,
      email: `${username}${i}@${pick(GENERIC_DOMAINS)}`,
      truthId: `truth_L4_username_A_${i}`,
      level: 4,
    };
    const r2: SourceRecord = {
      sourceRecordId: makeId(src2),
      source: src2,
      type: 'person',
      name: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
      username,
      email: `${username}${i + 50}@${pick(GENERIC_DOMAINS)}`,
      truthId: `truth_L4_username_B_${i}`, // Different person!
      level: 4,
    };
    records.push(r1, r2);
    // NO merge — trap!
    count += 2;
  }

  // Shared team email — different people using sales@company.com
  for (let i = 0; i < 10; i++) {
    const company = pick(COMPANY_NAMES);
    const teamEmail = `${pick(['sales', 'support', 'info', 'team', 'hello'])}@${company.toLowerCase()}.com`;
    const [src1, src2] = pickN(SOURCES, 2);

    const r1: SourceRecord = {
      sourceRecordId: makeId(src1),
      source: src1,
      type: 'person',
      name: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
      email: teamEmail,
      company: company,
      truthId: `truth_L4_team_A_${i}`,
      level: 4,
    };
    const r2: SourceRecord = {
      sourceRecordId: makeId(src2),
      source: src2,
      type: 'person',
      name: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
      email: teamEmail,
      company: company,
      truthId: `truth_L4_team_B_${i}`, // Different person, same team email!
      level: 4,
    };
    records.push(r1, r2);
    // NO merge — trap! Same email but different people
    count += 2;
  }

  // Ambiguous company names — Mercury Financial vs Mercury CI
  for (let i = 0; i < 10; i++) {
    const ambiguousName = pick(COMPANY_NAMES);
    const [src1, src2] = pickN(SOURCES, 2);

    const r1: SourceRecord = {
      sourceRecordId: makeId(src1),
      source: src1,
      type: 'company',
      name: ambiguousName,
      attributes: { industry: 'finance', domain: `${ambiguousName.toLowerCase()}-finance.com` },
      truthId: `truth_L4_company_A_${i}`,
      level: 4,
    };
    const r2: SourceRecord = {
      sourceRecordId: makeId(src2),
      source: src2,
      type: 'company',
      name: ambiguousName,
      attributes: { industry: 'technology', domain: `${ambiguousName.toLowerCase()}.io` },
      truthId: `truth_L4_company_B_${i}`, // Different company, same name!
      level: 4,
    };
    records.push(r1, r2);
    // NO merge — trap!
    count += 2;
  }

  return count;
}

function generateLevel5(records: SourceRecord[], merges: Array<[string, string]>): number {
  // Level 5: Topology — multi-source chains, job changes, partial data
  let count = 0;

  // Merge chains: A=B in source1, B=C in source2, therefore A=C
  for (let i = 0; i < 15; i++) {
    const truthId = `truth_L5_chain_${i}`;
    const first = pick(FIRST_NAMES);
    const last = pick(LAST_NAMES);
    const company = pick(COMPANY_NAMES);
    const email = makeEmail(first, last, `${company.toLowerCase()}.com`);
    const username = makeUsername(first, last);
    const sources = pickN(SOURCES, 3);

    // Source 1: has email, no username
    const r1: SourceRecord = {
      sourceRecordId: makeId(sources[0]),
      source: sources[0],
      type: 'person',
      name: `${first} ${last}`,
      email,
      truthId,
      level: 5,
    };
    // Source 2: has email AND username (the bridge)
    const r2: SourceRecord = {
      sourceRecordId: makeId(sources[1]),
      source: sources[1],
      type: 'person',
      name: `${first[0]}${last}`, // Abbreviated
      email,
      username,
      truthId,
      level: 5,
    };
    // Source 3: has username only, no email (can only link through source 2)
    const r3: SourceRecord = {
      sourceRecordId: makeId(sources[2]),
      source: sources[2],
      type: 'person',
      name: username, // Display name IS the username
      username,
      truthId,
      level: 5,
    };
    records.push(r1, r2, r3);
    merges.push([r1.sourceRecordId, r2.sourceRecordId]);
    merges.push([r2.sourceRecordId, r3.sourceRecordId]);
    // r1↔r3 should be inferred transitively
    count += 3;
  }

  // Job changers: same person, different company over time
  for (let i = 0; i < 10; i++) {
    const truthId = `truth_L5_jobchange_${i}`;
    const first = pick(FIRST_NAMES);
    const last = pick(LAST_NAMES);
    const [oldCompany, newCompany] = pickN(COMPANY_NAMES, 2);
    const personalEmail = makeEmail(first, last, pick(GENERIC_DOMAINS));
    const [src1, src2, src3] = pickN(SOURCES, 3);

    // Old job record — corporate email
    const r1: SourceRecord = {
      sourceRecordId: makeId(src1),
      source: src1,
      type: 'person',
      name: `${first} ${last}`,
      email: makeEmail(first, last, `${oldCompany.toLowerCase()}.com`),
      company: oldCompany,
      truthId,
      level: 5,
    };
    // Personal record — personal email (the link)
    const r2: SourceRecord = {
      sourceRecordId: makeId(src2),
      source: src2,
      type: 'person',
      name: `${first} ${last}`,
      email: personalEmail,
      attributes: { secondary_email: makeEmail(first, last, `${oldCompany.toLowerCase()}.com`) },
      truthId,
      level: 5,
    };
    // New job record — new corporate email
    const r3: SourceRecord = {
      sourceRecordId: makeId(src3),
      source: src3,
      type: 'person',
      name: `${first} ${last}`,
      email: makeEmail(first, last, `${newCompany.toLowerCase()}.com`),
      company: newCompany,
      truthId,
      level: 5,
    };
    records.push(r1, r2, r3);
    merges.push([r1.sourceRecordId, r2.sourceRecordId]);
    // r2↔r3 and r1↔r3 require deeper reasoning
    count += 3;
  }

  return count;
}

// ── Main Generator ──────────────────────────────────

export function generateGauntlet(seed?: number): GauntletDataset {
  // Reset counter
  recordCounter = 0;
  
  // Seed random for reproducibility (simple LCG)
  if (seed !== undefined) {
    let s = seed;
    const origRandom = Math.random;
    Math.random = () => {
      s = (s * 1664525 + 1013904223) & 0x7fffffff;
      return s / 0x7fffffff;
    };
    const result = _generate();
    Math.random = origRandom;
    return result;
  }
  
  return _generate();
}

function _generate(): GauntletDataset {
  const records: SourceRecord[] = [];
  const merges: Array<[string, string]> = [];
  const levelCounts: Record<number, number> = {};

  levelCounts[1] = generateLevel1(records, merges);
  levelCounts[2] = generateLevel2(records, merges);
  levelCounts[3] = generateLevel3(records, merges);
  levelCounts[4] = generateLevel4(records, merges);
  levelCounts[5] = generateLevel5(records, merges);

  const uniqueEntities = new Set(records.map(r => r.truthId)).size;

  return { records, uniqueEntities, levelCounts, expectedMerges: merges };
}

// ── CLI ─────────────────────────────────────────────

if (import.meta.url.endsWith(process.argv[1]?.replace(/^file:\/\//, '') || '')) {
  const dataset = generateGauntlet(42);
  console.log(`\ndpth Gauntlet — Ground Truth Dataset`);
  console.log(`${'─'.repeat(40)}`);
  console.log(`Total records:     ${dataset.records.length}`);
  console.log(`Unique entities:   ${dataset.uniqueEntities}`);
  console.log(`Expected merges:   ${dataset.expectedMerges.length}`);
  console.log(`\nPer level:`);
  for (const [level, count] of Object.entries(dataset.levelCounts)) {
    const names = ['', 'Gimmes', 'Normalization', 'Ambiguity', 'Traps', 'Topology'];
    console.log(`  Level ${level} (${names[+level]}): ${count} records`);
  }
}
