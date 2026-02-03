/**
 * dpth.io Credit Ledger API
 * 
 * The economic backbone of the network. Every contribution earns credits,
 * every intelligence query costs credits. The ledger is append-only and
 * auditable — designed for future token migration.
 * 
 * POST /api/dpth/credits?action=earn - Record credit earnings
 * POST /api/dpth/credits?action=spend - Spend credits
 * GET /api/dpth/credits?agentId=xxx - Get agent's balance + history
 * GET /api/dpth/credits?leaderboard - Top earners
 * GET /api/dpth/credits?supply - Network-wide credit stats
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

// ─── Types ───────────────────────────────────────────

type CreditAction = 'earn' | 'spend' | 'bonus' | 'penalty' | 'migration_snapshot';

interface CreditTransaction {
  id: string;
  agentId: string;
  action: CreditAction;
  amount: number;
  /** What triggered this transaction */
  reason: string;
  /** Category for analytics */
  category: 'storage' | 'compute' | 'gpu' | 'inference' | 'query' | 'bonus' | 'penalty' | 'system';
  /** Reference to related entity (task ID, chunk CID, etc.) */
  reference?: string;
  /** Running balance after this transaction */
  balanceAfter: number;
  timestamp: string;
}

interface AgentBalance {
  agentId: string;
  balance: number;
  totalEarned: number;
  totalSpent: number;
  /** Earnings by category */
  earningsByCategory: Record<string, number>;
  /** Spending by category */
  spendingByCategory: Record<string, number>;
  /** Transaction count */
  transactionCount: number;
  /** For future token claim */
  claimableCredits: number;
  /** Snapshot at last migration event (if any) */
  migrationSnapshot?: {
    balance: number;
    timestamp: string;
    snapshotId: string;
  };
  lastActivity: string;
}

interface CreditLedger {
  /** All transactions (append-only) */
  transactions: CreditTransaction[];
  /** Agent balances (derived, cached) */
  balances: Record<string, AgentBalance>;
  /** Network-wide stats */
  supply: {
    totalMinted: number;
    totalBurned: number;
    totalCirculating: number;
    totalTransactions: number;
  };
  /** Credit earning rates */
  rates: CreditRates;
}

interface CreditRates {
  /** Credits per MB of storage contributed per day */
  storagePerMbPerDay: number;
  /** Credits per compute task completed */
  computePerTask: number;
  /** Credits per GPU inference task */
  gpuPerInferenceTask: number;
  /** Credits per 1000 tokens generated */
  gpuPer1kTokens: number;
  /** Credits per image generated */
  gpuPerImage: number;
  /** Credits per successful storage proof */
  storageProofBonus: number;
  /** Credits to spend per intelligence query */
  queryBaseCost: number;
  /** Credits to spend per inference request */
  inferenceBaseCost: number;
  /** Reputation multiplier per tier */
  tierMultipliers: Record<string, number>;
}

// ─── Default Rates ───────────────────────────────────

const DEFAULT_RATES: CreditRates = {
  storagePerMbPerDay: 1,
  computePerTask: 10,
  gpuPerInferenceTask: 25,
  gpuPer1kTokens: 5,
  gpuPerImage: 15,
  storageProofBonus: 5,
  queryBaseCost: 1,
  inferenceBaseCost: 10,
  tierMultipliers: {
    newcomer: 1.0,
    contributor: 1.2,
    trusted: 1.5,
    elite: 2.0,
    legendary: 3.0,
  },
};

// ─── Storage ─────────────────────────────────────────

const DATA_DIR = process.env.DATA_DIR || 'data';
const CREDITS_FILE = path.join(DATA_DIR, 'dpth', 'credits.json');

async function ensureDir(filePath: string) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
}

async function loadLedger(): Promise<CreditLedger> {
  try {
    const data = await fs.readFile(CREDITS_FILE, 'utf-8');
    const ledger = JSON.parse(data);
    if (!ledger.rates) ledger.rates = DEFAULT_RATES;
    return ledger;
  } catch {
    return {
      transactions: [],
      balances: {},
      supply: {
        totalMinted: 0,
        totalBurned: 0,
        totalCirculating: 0,
        totalTransactions: 0,
      },
      rates: DEFAULT_RATES,
    };
  }
}

async function saveLedger(ledger: CreditLedger): Promise<void> {
  await ensureDir(CREDITS_FILE);
  await fs.writeFile(CREDITS_FILE, JSON.stringify(ledger, null, 2));
}

// ─── Helpers ─────────────────────────────────────────

function ensureBalance(ledger: CreditLedger, agentId: string): AgentBalance {
  if (!ledger.balances[agentId]) {
    ledger.balances[agentId] = {
      agentId,
      balance: 0,
      totalEarned: 0,
      totalSpent: 0,
      earningsByCategory: {},
      spendingByCategory: {},
      transactionCount: 0,
      claimableCredits: 0,
      lastActivity: new Date().toISOString(),
    };
  }
  return ledger.balances[agentId];
}

function recordTransaction(
  ledger: CreditLedger,
  agentId: string,
  action: CreditAction,
  amount: number,
  reason: string,
  category: CreditTransaction['category'],
  reference?: string
): CreditTransaction {
  const balance = ensureBalance(ledger, agentId);
  
  // Apply transaction
  if (action === 'earn' || action === 'bonus') {
    balance.balance += amount;
    balance.totalEarned += amount;
    balance.claimableCredits += amount;
    balance.earningsByCategory[category] = (balance.earningsByCategory[category] || 0) + amount;
    ledger.supply.totalMinted += amount;
    ledger.supply.totalCirculating += amount;
  } else if (action === 'spend') {
    if (balance.balance < amount) {
      throw new Error(`Insufficient credits: have ${balance.balance}, need ${amount}`);
    }
    balance.balance -= amount;
    balance.totalSpent += amount;
    balance.spendingByCategory[category] = (balance.spendingByCategory[category] || 0) + amount;
    ledger.supply.totalBurned += amount;
    ledger.supply.totalCirculating -= amount;
  } else if (action === 'penalty') {
    balance.balance = Math.max(0, balance.balance - amount);
    balance.claimableCredits = Math.max(0, balance.claimableCredits - amount);
    ledger.supply.totalBurned += amount;
    ledger.supply.totalCirculating -= Math.min(amount, balance.balance + amount);
  }
  
  balance.transactionCount++;
  balance.lastActivity = new Date().toISOString();
  
  const tx: CreditTransaction = {
    id: randomUUID(),
    agentId,
    action,
    amount,
    reason,
    category,
    reference,
    balanceAfter: balance.balance,
    timestamp: new Date().toISOString(),
  };
  
  ledger.transactions.push(tx);
  ledger.supply.totalTransactions++;
  
  return tx;
}

// ─── Handlers ────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get('agentId');
    const leaderboard = searchParams.get('leaderboard');
    const supply = searchParams.get('supply');
    const rates = searchParams.get('rates');
    
    const ledger = await loadLedger();
    
    // Return credit earning rates
    if (rates !== null) {
      return NextResponse.json({ rates: ledger.rates });
    }
    
    // Return network supply stats
    if (supply !== null) {
      const agentCount = Object.keys(ledger.balances).length;
      const activeAgents = Object.values(ledger.balances)
        .filter(b => {
          const lastActive = new Date(b.lastActivity).getTime();
          return Date.now() - lastActive < 24 * 60 * 60 * 1000; // Active in last 24h
        }).length;
      
      return NextResponse.json({
        supply: ledger.supply,
        agents: {
          total: agentCount,
          active24h: activeAgents,
        },
        averageBalance: agentCount > 0
          ? Math.round(ledger.supply.totalCirculating / agentCount)
          : 0,
      });
    }
    
    // Return leaderboard
    if (leaderboard !== null) {
      const limit = parseInt(searchParams.get('limit') || '10');
      const sortBy = searchParams.get('sort') || 'earned';
      
      const sorted = Object.values(ledger.balances)
        .sort((a, b) => {
          if (sortBy === 'balance') return b.balance - a.balance;
          if (sortBy === 'spent') return b.totalSpent - a.totalSpent;
          return b.totalEarned - a.totalEarned;
        })
        .slice(0, limit);
      
      return NextResponse.json({
        leaderboard: sorted.map((b, i) => ({
          rank: i + 1,
          agentId: b.agentId,
          balance: b.balance,
          totalEarned: b.totalEarned,
          totalSpent: b.totalSpent,
          transactionCount: b.transactionCount,
        })),
      });
    }
    
    // Return agent balance + recent transactions
    if (agentId) {
      const balance = ledger.balances[agentId];
      if (!balance) {
        return NextResponse.json({
          agentId,
          balance: 0,
          totalEarned: 0,
          totalSpent: 0,
          transactions: [],
        });
      }
      
      const recentTx = ledger.transactions
        .filter(tx => tx.agentId === agentId)
        .slice(-20)
        .reverse();
      
      return NextResponse.json({
        ...balance,
        recentTransactions: recentTx,
      });
    }
    
    return NextResponse.json({ error: 'Missing agentId, leaderboard, supply, or rates param' }, { status: 400 });
    
  } catch (error) {
    console.error('Failed to get credits:', error);
    return NextResponse.json({ error: 'Failed to get credits' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action') as CreditAction | null;
    const body = await request.json();
    
    const ledger = await loadLedger();
    
    // ─── Earn Credits ────────────────────────────────
    if (action === 'earn') {
      const { agentId, amount, reason, category, reference, tier } = body;
      
      if (!agentId || !amount || !reason || !category) {
        return NextResponse.json(
          { error: 'Missing agentId, amount, reason, or category' },
          { status: 400 }
        );
      }
      
      // Apply tier multiplier
      const multiplier = tier ? (ledger.rates.tierMultipliers[tier] || 1) : 1;
      const finalAmount = Math.round(amount * multiplier * 100) / 100;
      
      const tx = recordTransaction(ledger, agentId, 'earn', finalAmount, reason, category, reference);
      await saveLedger(ledger);
      
      return NextResponse.json({
        message: 'Credits earned',
        transaction: {
          id: tx.id,
          amount: tx.amount,
          multiplier,
          balanceAfter: tx.balanceAfter,
        },
      });
    }
    
    // ─── Spend Credits ───────────────────────────────
    if (action === 'spend') {
      const { agentId, amount, reason, category, reference } = body;
      
      if (!agentId || !amount || !reason || !category) {
        return NextResponse.json(
          { error: 'Missing agentId, amount, reason, or category' },
          { status: 400 }
        );
      }
      
      // Check balance
      const balance = ledger.balances[agentId];
      if (!balance || balance.balance < amount) {
        return NextResponse.json(
          { error: `Insufficient credits: have ${balance?.balance || 0}, need ${amount}` },
          { status: 402 }
        );
      }
      
      const tx = recordTransaction(ledger, agentId, 'spend', amount, reason, category, reference);
      await saveLedger(ledger);
      
      return NextResponse.json({
        message: 'Credits spent',
        transaction: {
          id: tx.id,
          amount: tx.amount,
          balanceAfter: tx.balanceAfter,
        },
      });
    }
    
    // ─── Migration Snapshot ──────────────────────────
    if (action === 'migration_snapshot') {
      // Snapshot all balances for future token claim
      const snapshotId = randomUUID();
      const timestamp = new Date().toISOString();
      
      for (const balance of Object.values(ledger.balances)) {
        balance.migrationSnapshot = {
          balance: balance.claimableCredits,
          timestamp,
          snapshotId,
        };
        
        // Record as system transaction
        recordTransaction(
          ledger,
          balance.agentId,
          'migration_snapshot',
          0,
          `Migration snapshot ${snapshotId}`,
          'system',
          snapshotId
        );
      }
      
      await saveLedger(ledger);
      
      const totalClaimable = Object.values(ledger.balances)
        .reduce((sum, b) => sum + b.claimableCredits, 0);
      
      return NextResponse.json({
        message: 'Migration snapshot created',
        snapshotId,
        timestamp,
        agentsSnapshotted: Object.keys(ledger.balances).length,
        totalClaimableCredits: totalClaimable,
      });
    }
    
    return NextResponse.json({ error: 'Invalid action (earn|spend|migration_snapshot)' }, { status: 400 });
    
  } catch (error) {
    if (error instanceof Error && error.message.includes('Insufficient')) {
      return NextResponse.json({ error: error.message }, { status: 402 });
    }
    console.error('Failed to process credit action:', error);
    return NextResponse.json({ error: 'Failed to process' }, { status: 500 });
  }
}
