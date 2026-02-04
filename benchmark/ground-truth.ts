/**
 * dpth Gauntlet v2 — Ground Truth Generator
 * 
 * Three tracks testing different dimensions of runtime intelligence:
 * 
 * TRACK A: Identity — Can you figure out who's who?
 *   L1. Gimmes — exact email matches
 *   L2. Normalization — name variants, casing, suffixes
 *   L3. Ambiguity — generic domains, common names
 *   L4. Traps — same username/email, different people
 *   L5. Topology — merge chains, job changes
 * 
 * TRACK B: Efficiency — Can you avoid wasted work?
 *   L6. Strategy selection — pick the right matching approach
 *   L7. Short circuits — know when to stop trying
 *   L8. Batch optimization — optimal order of operations
 * 
 * TRACK C: Adaptation — Can you handle the unexpected?
 *   L9.  Schema drift — source fields changed
 *   L10. Data quality — nulls, garbage, inconsistencies
 *   L11. Adversarial — deliberately misleading data
 * 
 * Metrics: accuracy, false merge rate, tokens used, operations count
 */

// ── Types ───────────────────────────────────────────

export interface SourceRecord {
  sourceRecordId: string;
  source: string;
  type: 'person' | 'company';
  name: string;
  email?: string;
  username?: string;
  company?: string;
  phone?: string;
  url?: string;
  attributes?: Record<string, string>;
  /** GROUND TRUTH: the real identity */
  truthId: string;
  /** Which gauntlet level */
  level: number;
  /** Track A/B/C */
  track: 'identity' | 'efficiency' | 'adaptation';
}

/** For Track B: defines the optimal resolution strategy */
export interface StrategyHint {
  recordPair: [string, string];
  /** Best strategy to try first */
  optimalStrategy: string;
  /** Strategies that waste tokens (work but are expensive) */
  wastefulStrategies: string[];
  /** Strategies that give wrong answers */
  dangerousStrategies: string[];
  /** Token cost of optimal path */
  optimalTokenCost: number;
  /** Token cost of naive path (try everything) */
  naiveTokenCost: number;
}

/** For Track C: defines the data quality issue */
export interface QualityIssue {
  recordId: string;
  issueType: 'null_field' | 'garbage_data' | 'stale_data' | 'schema_change' | 'adversarial';
  affectedField: string;
  description: string;
}

export interface GauntletDataset {
  records: SourceRecord[];
  uniqueEntities: number;
  levelCounts: Record<number, number>;
  expectedMerges: Array<[string, string]>;
  strategyHints: StrategyHint[];
  qualityIssues: QualityIssue[];
  /** Total records per track */
  trackCounts: Record<string, number>;
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

const PHONE_FORMATS = [
  (area: string, num: string) => `(${area}) ${num.slice(0,3)}-${num.slice(3)}`,
  (area: string, num: string) => `${area}-${num.slice(0,3)}-${num.slice(3)}`,
  (area: string, num: string) => `+1${area}${num}`,
  (area: string, num: string) => `${area}.${num.slice(0,3)}.${num.slice(3)}`,
  (area: string, num: string) => `1-${area}-${num.slice(0,3)}-${num.slice(3)}`,
];

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

function makePhone(): { area: string; num: string } {
  const area = (200 + Math.floor(Math.random() * 800)).toString();
  const num = Math.floor(1000000 + Math.random() * 9000000).toString();
  return { area, num };
}

// ── Token Cost Model ────────────────────────────────
// Simulates the cost of different matching strategies

export const STRATEGY_COSTS: Record<string, number> = {
  email_exact: 5,        // Cheap — just string comparison
  email_normalized: 10,  // Normalize + compare
  name_exact: 5,         // Cheap
  name_fuzzy: 50,        // Levenshtein / Jaro-Winkler
  name_abbreviation: 80, // Nickname lookup + fuzzy
  phone_normalized: 15,  // Normalize formats + compare
  alias_match: 10,       // Username comparison
  url_match: 10,         // Domain extraction + compare
  address_normalized: 100, // Complex normalization
  combined_multi_field: 150, // Run multiple strategies + weight
  llm_disambiguation: 500,  // Call an LLM to disambiguate
};

// ── TRACK A: Identity ───────────────────────────────

function generateLevel1(records: SourceRecord[], merges: Array<[string, string]>): number {
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
      sourceRecordId: makeId(src1), source: src1, type: 'person',
      name, email, truthId, level: 1, track: 'identity',
    };
    const r2: SourceRecord = {
      sourceRecordId: makeId(src2), source: src2, type: 'person',
      name, email, truthId, level: 1, track: 'identity',
    };
    records.push(r1, r2);
    merges.push([r1.sourceRecordId, r2.sourceRecordId]);
    count += 2;
  }
  return count;
}

function generateLevel2(records: SourceRecord[], merges: Array<[string, string]>): number {
  let count = 0;

  // Person name variants (nicknames)
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
      sourceRecordId: makeId(src1), source: src1, type: 'person',
      name: `${first} ${last}`, email, truthId, level: 2, track: 'identity',
    };
    const r2: SourceRecord = {
      sourceRecordId: makeId(src2), source: src2, type: 'person',
      name: `${nickname} ${last}`, email: email.toUpperCase(), truthId, level: 2, track: 'identity',
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
      sourceRecordId: makeId(src1), source: src1, type: 'company',
      name: `${base} ${suffix1}`, attributes: { domain }, truthId, level: 2, track: 'identity',
    };
    const r2: SourceRecord = {
      sourceRecordId: makeId(src2), source: src2, type: 'company',
      name: `${base.toUpperCase()} ${suffix2}`, attributes: { domain }, truthId, level: 2, track: 'identity',
    };
    records.push(r1, r2);
    merges.push([r1.sourceRecordId, r2.sourceRecordId]);
    count += 2;
  }

  // Phone number format variants
  for (let i = 0; i < 10; i++) {
    const truthId = `truth_L2_phone_${i}`;
    const first = pick(FIRST_NAMES);
    const last = pick(LAST_NAMES);
    const { area, num } = makePhone();
    const fmt1 = pick(PHONE_FORMATS);
    const fmt2 = pick(PHONE_FORMATS.filter(f => f !== fmt1));
    const [src1, src2] = pickN(SOURCES, 2);

    const r1: SourceRecord = {
      sourceRecordId: makeId(src1), source: src1, type: 'person',
      name: `${first} ${last}`, phone: fmt1(area, num), truthId, level: 2, track: 'identity',
    };
    const r2: SourceRecord = {
      sourceRecordId: makeId(src2), source: src2, type: 'person',
      name: `${first} ${last}`, phone: fmt2(area, num), truthId, level: 2, track: 'identity',
    };
    records.push(r1, r2);
    merges.push([r1.sourceRecordId, r2.sourceRecordId]);
    count += 2;
  }

  return count;
}

function generateLevel3(records: SourceRecord[], merges: Array<[string, string]>): number {
  let count = 0;

  // Same person, generic domain, abbreviated name
  for (let i = 0; i < 20; i++) {
    const truthId = `truth_L3_match_${i}`;
    const first = pick(FIRST_NAMES);
    const last = pick(LAST_NAMES);
    const domain = pick(GENERIC_DOMAINS);
    const email = makeEmail(first, last, domain);
    const [src1, src2] = pickN(SOURCES, 2);

    const r1: SourceRecord = {
      sourceRecordId: makeId(src1), source: src1, type: 'person',
      name: `${first} ${last}`, email, truthId, level: 3, track: 'identity',
    };
    const r2: SourceRecord = {
      sourceRecordId: makeId(src2), source: src2, type: 'person',
      name: `${first[0]}. ${last}`, email, truthId, level: 3, track: 'identity',
    };
    records.push(r1, r2);
    merges.push([r1.sourceRecordId, r2.sourceRecordId]);
    count += 2;
  }

  // Different people, same common name (should NOT merge)
  for (let i = 0; i < 15; i++) {
    const first = pick(['John', 'James', 'Mary', 'David', 'Michael']);
    const last = pick(['Smith', 'Johnson', 'Williams', 'Brown', 'Jones']);
    const [src1, src2] = pickN(SOURCES, 2);

    const r1: SourceRecord = {
      sourceRecordId: makeId(src1), source: src1, type: 'person',
      name: `${first} ${last}`,
      email: `${first.toLowerCase()}.${last.toLowerCase()}${i}@${pick(GENERIC_DOMAINS)}`,
      truthId: `truth_L3_nomatch_A_${i}`, level: 3, track: 'identity',
    };
    const r2: SourceRecord = {
      sourceRecordId: makeId(src2), source: src2, type: 'person',
      name: `${first} ${last}`,
      email: `${first.toLowerCase()}${last.toLowerCase()}${i + 100}@${pick(GENERIC_DOMAINS)}`,
      truthId: `truth_L3_nomatch_B_${i}`, level: 3, track: 'identity',
    };
    records.push(r1, r2);
    count += 2;
  }

  return count;
}

function generateLevel4(records: SourceRecord[], merges: Array<[string, string]>): number {
  let count = 0;

  // Same username, different people
  for (let i = 0; i < 10; i++) {
    const username = pick(['jsmith', 'admin', 'dev', 'mwilson', 'jdoe', 'user1', 'test', 'alex']);
    const [src1, src2] = pickN(SOURCES, 2);

    const r1: SourceRecord = {
      sourceRecordId: makeId(src1), source: src1, type: 'person',
      name: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
      username, email: `${username}${i}@${pick(GENERIC_DOMAINS)}`,
      truthId: `truth_L4_username_A_${i}`, level: 4, track: 'identity',
    };
    const r2: SourceRecord = {
      sourceRecordId: makeId(src2), source: src2, type: 'person',
      name: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
      username, email: `${username}${i + 50}@${pick(GENERIC_DOMAINS)}`,
      truthId: `truth_L4_username_B_${i}`, level: 4, track: 'identity',
    };
    records.push(r1, r2);
    count += 2;
  }

  // Shared team email, different people
  for (let i = 0; i < 10; i++) {
    const company = pick(COMPANY_NAMES);
    const teamEmail = `${pick(['sales', 'support', 'info', 'team', 'hello'])}@${company.toLowerCase()}.com`;
    const [src1, src2] = pickN(SOURCES, 2);

    const r1: SourceRecord = {
      sourceRecordId: makeId(src1), source: src1, type: 'person',
      name: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
      email: teamEmail, company, truthId: `truth_L4_team_A_${i}`, level: 4, track: 'identity',
    };
    const r2: SourceRecord = {
      sourceRecordId: makeId(src2), source: src2, type: 'person',
      name: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
      email: teamEmail, company, truthId: `truth_L4_team_B_${i}`, level: 4, track: 'identity',
    };
    records.push(r1, r2);
    count += 2;
  }

  // Ambiguous company names
  for (let i = 0; i < 10; i++) {
    const ambiguousName = pick(COMPANY_NAMES);
    const [src1, src2] = pickN(SOURCES, 2);

    const r1: SourceRecord = {
      sourceRecordId: makeId(src1), source: src1, type: 'company',
      name: ambiguousName,
      attributes: { industry: 'finance', domain: `${ambiguousName.toLowerCase()}-finance.com` },
      truthId: `truth_L4_company_A_${i}`, level: 4, track: 'identity',
    };
    const r2: SourceRecord = {
      sourceRecordId: makeId(src2), source: src2, type: 'company',
      name: ambiguousName,
      attributes: { industry: 'technology', domain: `${ambiguousName.toLowerCase()}.io` },
      truthId: `truth_L4_company_B_${i}`, level: 4, track: 'identity',
    };
    records.push(r1, r2);
    count += 2;
  }

  return count;
}

function generateLevel5(records: SourceRecord[], merges: Array<[string, string]>): number {
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

    const r1: SourceRecord = {
      sourceRecordId: makeId(sources[0]), source: sources[0], type: 'person',
      name: `${first} ${last}`, email, truthId, level: 5, track: 'identity',
    };
    const r2: SourceRecord = {
      sourceRecordId: makeId(sources[1]), source: sources[1], type: 'person',
      name: `${first[0]}${last}`, email, username, truthId, level: 5, track: 'identity',
    };
    const r3: SourceRecord = {
      sourceRecordId: makeId(sources[2]), source: sources[2], type: 'person',
      name: username, username, truthId, level: 5, track: 'identity',
    };
    records.push(r1, r2, r3);
    merges.push([r1.sourceRecordId, r2.sourceRecordId]);
    merges.push([r2.sourceRecordId, r3.sourceRecordId]);
    count += 3;
  }

  // Job changers
  for (let i = 0; i < 10; i++) {
    const truthId = `truth_L5_jobchange_${i}`;
    const first = pick(FIRST_NAMES);
    const last = pick(LAST_NAMES);
    const [oldCompany, newCompany] = pickN(COMPANY_NAMES, 2);
    const [src1, src2, src3] = pickN(SOURCES, 3);

    const r1: SourceRecord = {
      sourceRecordId: makeId(src1), source: src1, type: 'person',
      name: `${first} ${last}`,
      email: makeEmail(first, last, `${oldCompany.toLowerCase()}.com`),
      company: oldCompany, truthId, level: 5, track: 'identity',
    };
    const r2: SourceRecord = {
      sourceRecordId: makeId(src2), source: src2, type: 'person',
      name: `${first} ${last}`,
      email: makeEmail(first, last, pick(GENERIC_DOMAINS)),
      attributes: { secondary_email: makeEmail(first, last, `${oldCompany.toLowerCase()}.com`) },
      truthId, level: 5, track: 'identity',
    };
    const r3: SourceRecord = {
      sourceRecordId: makeId(src3), source: src3, type: 'person',
      name: `${first} ${last}`,
      email: makeEmail(first, last, `${newCompany.toLowerCase()}.com`),
      company: newCompany, truthId, level: 5, track: 'identity',
    };
    records.push(r1, r2, r3);
    merges.push([r1.sourceRecordId, r2.sourceRecordId]);
    count += 3;
  }

  return count;
}

// ── TRACK B: Efficiency ─────────────────────────────

function generateLevel6(
  records: SourceRecord[],
  merges: Array<[string, string]>,
  hints: StrategyHint[]
): number {
  // Level 6: Strategy selection — some pairs have cheap+accurate matches,
  // some have expensive matches. The network should know which to try first.
  let count = 0;

  // Pairs with corporate email (cheap to match) but also fuzzy name (expensive)
  for (let i = 0; i < 20; i++) {
    const truthId = `truth_L6_cheap_${i}`;
    const first = pick(FIRST_NAMES);
    const last = pick(LAST_NAMES);
    const company = pick(COMPANY_NAMES);
    const domain = `${company.toLowerCase()}.com`;
    const email = makeEmail(first, last, domain);
    const [src1, src2] = pickN(SOURCES, 2);

    const r1: SourceRecord = {
      sourceRecordId: makeId(src1), source: src1, type: 'person',
      name: `${first} ${last}`, email, company, username: makeUsername(first, last),
      phone: pick(PHONE_FORMATS)(makePhone().area, makePhone().num),
      truthId, level: 6, track: 'efficiency',
    };
    const r2: SourceRecord = {
      sourceRecordId: makeId(src2), source: src2, type: 'person',
      name: `${first[0]}. ${last}`, email, company, username: makeUsername(first, last),
      phone: pick(PHONE_FORMATS)(makePhone().area, makePhone().num),
      truthId, level: 6, track: 'efficiency',
    };
    records.push(r1, r2);
    merges.push([r1.sourceRecordId, r2.sourceRecordId]);

    hints.push({
      recordPair: [r1.sourceRecordId, r2.sourceRecordId],
      optimalStrategy: 'email_exact',
      wastefulStrategies: ['name_fuzzy', 'phone_normalized', 'combined_multi_field'],
      dangerousStrategies: [],
      optimalTokenCost: STRATEGY_COSTS.email_exact,
      naiveTokenCost: Object.values(STRATEGY_COSTS).reduce((a, b) => a + b, 0),
    });
    count += 2;
  }

  // Pairs where ONLY fuzzy name works (no shared email/phone/username)
  for (let i = 0; i < 15; i++) {
    const truthId = `truth_L6_expensive_${i}`;
    const first = pick(Object.keys(NICKNAMES));
    const nickname = pick(NICKNAMES[first]!);
    const last = pick(LAST_NAMES);
    const [src1, src2] = pickN(SOURCES, 2);

    const r1: SourceRecord = {
      sourceRecordId: makeId(src1), source: src1, type: 'person',
      name: `${first} ${last}`,
      email: makeEmail(first, last, pick(CORPORATE_DOMAINS)),
      truthId, level: 6, track: 'efficiency',
    };
    const r2: SourceRecord = {
      sourceRecordId: makeId(src2), source: src2, type: 'person',
      name: `${nickname} ${last}`,
      email: makeEmail(nickname, last, pick(CORPORATE_DOMAINS)),
      truthId, level: 6, track: 'efficiency',
    };
    records.push(r1, r2);
    merges.push([r1.sourceRecordId, r2.sourceRecordId]);

    hints.push({
      recordPair: [r1.sourceRecordId, r2.sourceRecordId],
      optimalStrategy: 'name_abbreviation',
      wastefulStrategies: ['combined_multi_field', 'llm_disambiguation'],
      dangerousStrategies: ['email_exact'], // Different emails — would incorrectly reject
      optimalTokenCost: STRATEGY_COSTS.name_abbreviation,
      naiveTokenCost: Object.values(STRATEGY_COSTS).reduce((a, b) => a + b, 0),
    });
    count += 2;
  }

  // Pairs where you should NOT try (waste of tokens — different people)
  for (let i = 0; i < 10; i++) {
    const [src1, src2] = pickN(SOURCES, 2);
    const r1: SourceRecord = {
      sourceRecordId: makeId(src1), source: src1, type: 'person',
      name: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
      email: makeEmail(pick(FIRST_NAMES), pick(LAST_NAMES), pick(GENERIC_DOMAINS)),
      truthId: `truth_L6_skip_A_${i}`, level: 6, track: 'efficiency',
    };
    const r2: SourceRecord = {
      sourceRecordId: makeId(src2), source: src2, type: 'person',
      name: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
      email: makeEmail(pick(FIRST_NAMES), pick(LAST_NAMES), pick(GENERIC_DOMAINS)),
      truthId: `truth_L6_skip_B_${i}`, level: 6, track: 'efficiency',
    };
    records.push(r1, r2);

    hints.push({
      recordPair: [r1.sourceRecordId, r2.sourceRecordId],
      optimalStrategy: 'skip', // Don't even try
      wastefulStrategies: ['name_fuzzy', 'combined_multi_field', 'llm_disambiguation'],
      dangerousStrategies: [],
      optimalTokenCost: 0,
      naiveTokenCost: Object.values(STRATEGY_COSTS).reduce((a, b) => a + b, 0),
    });
    count += 2;
  }

  return count;
}

function generateLevel7(
  records: SourceRecord[],
  merges: Array<[string, string]>,
  hints: StrategyHint[]
): number {
  // Level 7: Short circuits — know when a single signal is definitive
  // Don't keep checking after you have a strong match/non-match
  let count = 0;

  // Corporate email match = definitive (don't check 5 more things)
  for (let i = 0; i < 15; i++) {
    const truthId = `truth_L7_definitive_${i}`;
    const first = pick(FIRST_NAMES);
    const last = pick(LAST_NAMES);
    const company = pick(COMPANY_NAMES);
    const email = `${first.toLowerCase()}.${last.toLowerCase()}@${company.toLowerCase()}.com`;
    const [src1, src2] = pickN(SOURCES, 2);
    const { area, num } = makePhone();

    const r1: SourceRecord = {
      sourceRecordId: makeId(src1), source: src1, type: 'person',
      name: `${first} ${last}`, email, company,
      phone: PHONE_FORMATS[0](area, num),
      username: makeUsername(first, last),
      url: `https://linkedin.com/in/${first.toLowerCase()}-${last.toLowerCase()}`,
      truthId, level: 7, track: 'efficiency',
    };
    const r2: SourceRecord = {
      sourceRecordId: makeId(src2), source: src2, type: 'person',
      name: `${first} ${last}`, email, company,
      phone: PHONE_FORMATS[1](area, num),
      username: makeUsername(first, last),
      url: `https://github.com/${first.toLowerCase()}${last.toLowerCase()}`,
      truthId, level: 7, track: 'efficiency',
    };
    records.push(r1, r2);
    merges.push([r1.sourceRecordId, r2.sourceRecordId]);

    hints.push({
      recordPair: [r1.sourceRecordId, r2.sourceRecordId],
      optimalStrategy: 'email_exact',
      wastefulStrategies: ['phone_normalized', 'alias_match', 'url_match', 'name_fuzzy'],
      dangerousStrategies: [],
      optimalTokenCost: STRATEGY_COSTS.email_exact,
      naiveTokenCost: STRATEGY_COSTS.email_exact + STRATEGY_COSTS.phone_normalized +
        STRATEGY_COSTS.alias_match + STRATEGY_COSTS.url_match + STRATEGY_COSTS.name_fuzzy,
    });
    count += 2;
  }

  // Different people — a single field mismatch should stop all further checks
  for (let i = 0; i < 10; i++) {
    const [src1, src2] = pickN(SOURCES, 2);
    const company1 = pick(COMPANY_NAMES);
    const company2 = pick(COMPANY_NAMES.filter(c => c !== company1));

    const r1: SourceRecord = {
      sourceRecordId: makeId(src1), source: src1, type: 'person',
      name: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
      email: `someone@${company1.toLowerCase()}.com`,
      company: company1,
      truthId: `truth_L7_bail_A_${i}`, level: 7, track: 'efficiency',
    };
    const r2: SourceRecord = {
      sourceRecordId: makeId(src2), source: src2, type: 'person',
      name: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
      email: `someone@${company2.toLowerCase()}.com`,
      company: company2,
      truthId: `truth_L7_bail_B_${i}`, level: 7, track: 'efficiency',
    };
    records.push(r1, r2);

    hints.push({
      recordPair: [r1.sourceRecordId, r2.sourceRecordId],
      optimalStrategy: 'email_exact', // Quick check: different → bail
      wastefulStrategies: ['name_fuzzy', 'phone_normalized', 'combined_multi_field'],
      dangerousStrategies: [],
      optimalTokenCost: STRATEGY_COSTS.email_exact,
      naiveTokenCost: STRATEGY_COSTS.email_exact + STRATEGY_COSTS.name_fuzzy +
        STRATEGY_COSTS.phone_normalized + STRATEGY_COSTS.combined_multi_field,
    });
    count += 2;
  }

  return count;
}

function generateLevel8(
  records: SourceRecord[],
  merges: Array<[string, string]>,
  hints: StrategyHint[]
): number {
  // Level 8: Batch optimization — when resolving N records, optimal ordering
  // matters. Process high-confidence pairs first, build transitive links.
  let count = 0;

  // A cluster of 5 records for one person across different sources
  // Optimal: resolve the email matches first (fast), then use transitivity
  for (let i = 0; i < 8; i++) {
    const truthId = `truth_L8_cluster_${i}`;
    const first = pick(FIRST_NAMES);
    const last = pick(LAST_NAMES);
    const company = pick(COMPANY_NAMES);
    const email = `${first.toLowerCase()}.${last.toLowerCase()}@${company.toLowerCase()}.com`;
    const username = makeUsername(first, last);
    const sources = pickN(SOURCES, 5);

    const recs: SourceRecord[] = [];

    // Rec 0: email + name
    recs.push({
      sourceRecordId: makeId(sources[0]), source: sources[0], type: 'person',
      name: `${first} ${last}`, email, truthId, level: 8, track: 'efficiency',
    });
    // Rec 1: email + different name format
    recs.push({
      sourceRecordId: makeId(sources[1]), source: sources[1], type: 'person',
      name: `${first[0]}. ${last}`, email, truthId, level: 8, track: 'efficiency',
    });
    // Rec 2: username + name (no email)
    recs.push({
      sourceRecordId: makeId(sources[2]), source: sources[2], type: 'person',
      name: `${first} ${last}`, username, truthId, level: 8, track: 'efficiency',
    });
    // Rec 3: username only
    recs.push({
      sourceRecordId: makeId(sources[3]), source: sources[3], type: 'person',
      name: username, username, truthId, level: 8, track: 'efficiency',
    });
    // Rec 4: name + company only (weakest link)
    recs.push({
      sourceRecordId: makeId(sources[4]), source: sources[4], type: 'person',
      name: `${first} ${last}`, company, truthId, level: 8, track: 'efficiency',
    });

    records.push(...recs);

    // Expected merges (minimum spanning tree)
    merges.push([recs[0].sourceRecordId, recs[1].sourceRecordId]); // email match
    merges.push([recs[0].sourceRecordId, recs[2].sourceRecordId]); // name match
    merges.push([recs[2].sourceRecordId, recs[3].sourceRecordId]); // username match
    merges.push([recs[2].sourceRecordId, recs[4].sourceRecordId]); // name match

    // The optimal strategy: resolve email pairs first (O(1) cost),
    // then use established identity to resolve weaker signals
    hints.push({
      recordPair: [recs[0].sourceRecordId, recs[1].sourceRecordId],
      optimalStrategy: 'email_exact',
      wastefulStrategies: ['combined_multi_field'],
      dangerousStrategies: [],
      optimalTokenCost: STRATEGY_COSTS.email_exact,
      naiveTokenCost: STRATEGY_COSTS.combined_multi_field,
    });

    count += 5;
  }

  return count;
}

// ── TRACK C: Adaptation ─────────────────────────────

function generateLevel9(
  records: SourceRecord[],
  merges: Array<[string, string]>,
  issues: QualityIssue[]
): number {
  // Level 9: Schema drift — fields that moved, renamed, or changed format
  let count = 0;

  for (let i = 0; i < 15; i++) {
    const truthId = `truth_L9_drift_${i}`;
    const first = pick(FIRST_NAMES);
    const last = pick(LAST_NAMES);
    const email = makeEmail(first, last, pick(CORPORATE_DOMAINS));
    const [src1, src2] = pickN(SOURCES, 2);

    // Source 1: normal record
    const r1: SourceRecord = {
      sourceRecordId: makeId(src1), source: src1, type: 'person',
      name: `${first} ${last}`, email, truthId, level: 9, track: 'adaptation',
    };

    // Source 2: schema drifted — email is in an attribute field instead
    const r2: SourceRecord = {
      sourceRecordId: makeId(src2), source: src2, type: 'person',
      name: `${first} ${last}`,
      // email field is MISSING — it moved to attributes
      attributes: { contact_email: email, email_v2: email },
      truthId, level: 9, track: 'adaptation',
    };

    records.push(r1, r2);
    merges.push([r1.sourceRecordId, r2.sourceRecordId]);

    issues.push({
      recordId: r2.sourceRecordId,
      issueType: 'schema_change',
      affectedField: 'email',
      description: `Email moved from top-level field to attributes.contact_email in ${src2}`,
    });
    count += 2;
  }

  return count;
}

function generateLevel10(
  records: SourceRecord[],
  merges: Array<[string, string]>,
  issues: QualityIssue[]
): number {
  // Level 10: Data quality — nulls, garbage, typos, inconsistencies
  let count = 0;

  // Records with garbage/placeholder emails
  for (let i = 0; i < 10; i++) {
    const truthId = `truth_L10_garbage_${i}`;
    const first = pick(FIRST_NAMES);
    const last = pick(LAST_NAMES);
    const realEmail = makeEmail(first, last, pick(CORPORATE_DOMAINS));
    const [src1, src2] = pickN(SOURCES, 2);

    const r1: SourceRecord = {
      sourceRecordId: makeId(src1), source: src1, type: 'person',
      name: `${first} ${last}`, email: realEmail, truthId, level: 10, track: 'adaptation',
    };
    const garbageEmails = ['test@test.com', 'no-reply@example.com', 'n/a', 'none@none.com',
      'noemail@noemail.com', 'unknown@unknown.com', 'placeholder@placeholder.com'];
    const r2: SourceRecord = {
      sourceRecordId: makeId(src2), source: src2, type: 'person',
      name: `${first} ${last}`, email: pick(garbageEmails), truthId, level: 10, track: 'adaptation',
    };

    records.push(r1, r2);
    merges.push([r1.sourceRecordId, r2.sourceRecordId]);

    issues.push({
      recordId: r2.sourceRecordId,
      issueType: 'garbage_data',
      affectedField: 'email',
      description: `Placeholder/garbage email in ${src2} — should not be used for matching`,
    });
    count += 2;
  }

  // Records with null/missing critical fields
  for (let i = 0; i < 10; i++) {
    const truthId = `truth_L10_null_${i}`;
    const first = pick(FIRST_NAMES);
    const last = pick(LAST_NAMES);
    const [src1, src2] = pickN(SOURCES, 2);

    const r1: SourceRecord = {
      sourceRecordId: makeId(src1), source: src1, type: 'person',
      name: `${first} ${last}`,
      email: makeEmail(first, last, pick(CORPORATE_DOMAINS)),
      username: makeUsername(first, last),
      truthId, level: 10, track: 'adaptation',
    };
    // Source 2: barely any data
    const r2: SourceRecord = {
      sourceRecordId: makeId(src2), source: src2, type: 'person',
      name: `${first} ${last}`,
      // No email, no username, no phone — just a name
      truthId, level: 10, track: 'adaptation',
    };

    records.push(r1, r2);
    merges.push([r1.sourceRecordId, r2.sourceRecordId]);

    issues.push({
      recordId: r2.sourceRecordId,
      issueType: 'null_field',
      affectedField: 'email,username',
      description: `Missing email and username in ${src2} — name-only matching required`,
    });
    count += 2;
  }

  return count;
}

function generateLevel11(
  records: SourceRecord[],
  merges: Array<[string, string]>,
  issues: QualityIssue[]
): number {
  // Level 11: Adversarial — deliberately misleading data
  let count = 0;

  // Spoofed identity: someone using another person's email
  for (let i = 0; i < 8; i++) {
    const [src1, src2] = pickN(SOURCES, 2);
    const realFirst = pick(FIRST_NAMES);
    const realLast = pick(LAST_NAMES);
    const fakeFirst = pick(FIRST_NAMES.filter(n => n !== realFirst));
    const fakeLast = pick(LAST_NAMES.filter(n => n !== realLast));
    const stolenEmail = makeEmail(realFirst, realLast, pick(CORPORATE_DOMAINS));

    // Real person
    const r1: SourceRecord = {
      sourceRecordId: makeId(src1), source: src1, type: 'person',
      name: `${realFirst} ${realLast}`, email: stolenEmail,
      truthId: `truth_L11_real_${i}`, level: 11, track: 'adaptation',
    };
    // Impersonator using the same email
    const r2: SourceRecord = {
      sourceRecordId: makeId(src2), source: src2, type: 'person',
      name: `${fakeFirst} ${fakeLast}`, email: stolenEmail,
      truthId: `truth_L11_fake_${i}`, // Different person!
      level: 11, track: 'adaptation',
    };

    records.push(r1, r2);
    // NO merge — despite matching email, different names should raise suspicion

    issues.push({
      recordId: r2.sourceRecordId,
      issueType: 'adversarial',
      affectedField: 'email',
      description: `Possible identity spoofing — email matches but name is completely different`,
    });
    count += 2;
  }

  // Data injection: records designed to force false merges
  for (let i = 0; i < 7; i++) {
    const [src1, src2] = pickN(SOURCES, 2);
    const targetFirst = pick(FIRST_NAMES);
    const targetLast = pick(LAST_NAMES);

    // Legitimate record
    const r1: SourceRecord = {
      sourceRecordId: makeId(src1), source: src1, type: 'person',
      name: `${targetFirst} ${targetLast}`,
      email: makeEmail(targetFirst, targetLast, pick(CORPORATE_DOMAINS)),
      company: pick(COMPANY_NAMES),
      truthId: `truth_L11_target_${i}`, level: 11, track: 'adaptation',
    };
    // Injected record: same name, similar email pattern, different person
    const r2: SourceRecord = {
      sourceRecordId: makeId(src2), source: src2, type: 'person',
      name: `${targetFirst} ${targetLast}`,
      email: makeEmail(targetFirst, targetLast, pick(GENERIC_DOMAINS)), // Similar but different domain
      company: pick(COMPANY_NAMES),
      truthId: `truth_L11_injected_${i}`, // Different person!
      level: 11, track: 'adaptation',
    };

    records.push(r1, r2);
    // NO merge — different people with suspiciously similar data

    issues.push({
      recordId: r2.sourceRecordId,
      issueType: 'adversarial',
      affectedField: 'name,email',
      description: `Possible data injection — similar to existing record but different identity`,
    });
    count += 2;
  }

  return count;
}

// ── Main Generator ──────────────────────────────────

export function generateGauntlet(seed?: number): GauntletDataset {
  recordCounter = 0;

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
  const hints: StrategyHint[] = [];
  const issues: QualityIssue[] = [];
  const levelCounts: Record<number, number> = {};

  // Track A: Identity
  levelCounts[1] = generateLevel1(records, merges);
  levelCounts[2] = generateLevel2(records, merges);
  levelCounts[3] = generateLevel3(records, merges);
  levelCounts[4] = generateLevel4(records, merges);
  levelCounts[5] = generateLevel5(records, merges);

  // Track B: Efficiency
  levelCounts[6] = generateLevel6(records, merges, hints);
  levelCounts[7] = generateLevel7(records, merges, hints);
  levelCounts[8] = generateLevel8(records, merges, hints);

  // Track C: Adaptation
  levelCounts[9] = generateLevel9(records, merges, issues);
  levelCounts[10] = generateLevel10(records, merges, issues);
  levelCounts[11] = generateLevel11(records, merges, issues);

  const uniqueEntities = new Set(records.map(r => r.truthId)).size;

  const trackCounts: Record<string, number> = {
    identity: records.filter(r => r.track === 'identity').length,
    efficiency: records.filter(r => r.track === 'efficiency').length,
    adaptation: records.filter(r => r.track === 'adaptation').length,
  };

  return { records, uniqueEntities, levelCounts, expectedMerges: merges, strategyHints: hints, qualityIssues: issues, trackCounts };
}

// ── CLI ─────────────────────────────────────────────

if (import.meta.url.endsWith(process.argv[1]?.replace(/^file:\/\//, '') || '')) {
  const dataset = generateGauntlet(42);
  console.log(`\ndpth Gauntlet v2 — Ground Truth Dataset`);
  console.log(`${'─'.repeat(50)}`);
  console.log(`Total records:      ${dataset.records.length}`);
  console.log(`Unique entities:    ${dataset.uniqueEntities}`);
  console.log(`Expected merges:    ${dataset.expectedMerges.length}`);
  console.log(`Strategy hints:     ${dataset.strategyHints.length}`);
  console.log(`Quality issues:     ${dataset.qualityIssues.length}`);
  console.log(`\nTrack A (Identity):    ${dataset.trackCounts.identity} records`);
  console.log(`Track B (Efficiency):  ${dataset.trackCounts.efficiency} records`);
  console.log(`Track C (Adaptation):  ${dataset.trackCounts.adaptation} records`);
  console.log(`\nPer level:`);
  const names: Record<number, string> = {
    1: 'Gimmes', 2: 'Normalization', 3: 'Ambiguity', 4: 'Traps', 5: 'Topology',
    6: 'Strategy Selection', 7: 'Short Circuits', 8: 'Batch Optimization',
    9: 'Schema Drift', 10: 'Data Quality', 11: 'Adversarial',
  };
  for (const [level, count] of Object.entries(dataset.levelCounts)) {
    console.log(`  L${level.padStart(2)}: ${(names[+level] || '').padEnd(22)} ${count} records`);
  }
}
