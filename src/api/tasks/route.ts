/**
 * dpth.io Task Queue API
 * 
 * Distributed compute via task queue. Agents claim tasks, process them, return results.
 * 
 * GET /api/dpth/tasks - List available tasks (for agents to claim)
 * POST /api/dpth/tasks - Create a new task
 * POST /api/dpth/tasks/claim - Claim a task (agent starts work)
 * POST /api/dpth/tasks/complete - Complete a task (agent returns result)
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

// ─── Types ───────────────────────────────────────────

type TaskType = 'embed' | 'correlate' | 'extract' | 'analyze' | 'inference';
type TaskStatus = 'pending' | 'claimed' | 'completed' | 'failed';
type TaskPriority = 'low' | 'normal' | 'high' | 'critical';

interface Task {
  id: string;
  type: TaskType;
  priority: TaskPriority;
  status: TaskStatus;
  
  /** Input data for the task */
  input: {
    /** Content-addressed ID of input data */
    cid?: string;
    /** Inline data (for small payloads) */
    data?: unknown;
    /** Parameters for the task */
    params?: Record<string, unknown>;
  };
  
  /** Output from completed task */
  output?: {
    cid?: string;
    data?: unknown;
    error?: string;
  };
  
  /** Who created this task */
  createdBy: string;
  createdAt: string;
  
  /** Agent that claimed this task */
  claimedBy?: string;
  claimedAt?: string;
  
  /** When task was completed/failed */
  completedAt?: string;
  
  /** Deadline for completion (claimed tasks) */
  deadline?: string;
  
  /** Retry count */
  retries: number;
  maxRetries: number;
}

interface TaskQueue {
  tasks: Task[];
  stats: {
    totalCreated: number;
    totalCompleted: number;
    totalFailed: number;
  };
}

// ─── Storage ─────────────────────────────────────────

const DATA_DIR = process.env.DATA_DIR || 'data';
const TASKS_FILE = path.join(DATA_DIR, 'dpth', 'tasks.json');

async function ensureDir(filePath: string) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
}

async function loadQueue(): Promise<TaskQueue> {
  try {
    const data = await fs.readFile(TASKS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return { 
      tasks: [], 
      stats: { totalCreated: 0, totalCompleted: 0, totalFailed: 0 } 
    };
  }
}

async function saveQueue(queue: TaskQueue): Promise<void> {
  await ensureDir(TASKS_FILE);
  await fs.writeFile(TASKS_FILE, JSON.stringify(queue, null, 2));
}

// ─── Helpers ─────────────────────────────────────────

function cleanupStaleTasks(queue: TaskQueue): number {
  const now = new Date();
  let cleaned = 0;
  
  for (const task of queue.tasks) {
    if (task.status === 'claimed' && task.deadline) {
      const deadline = new Date(task.deadline);
      if (now > deadline) {
        // Task timed out, reset to pending
        task.status = 'pending';
        task.claimedBy = undefined;
        task.claimedAt = undefined;
        task.deadline = undefined;
        task.retries++;
        
        if (task.retries >= task.maxRetries) {
          task.status = 'failed';
          task.output = { error: 'Max retries exceeded' };
          task.completedAt = now.toISOString();
          queue.stats.totalFailed++;
        }
        
        cleaned++;
      }
    }
  }
  
  return cleaned;
}

// ─── Handlers ────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get('agentId');
    const taskType = searchParams.get('type') as TaskType | null;
    const limit = parseInt(searchParams.get('limit') || '10');
    
    const queue = await loadQueue();
    
    // Cleanup stale claimed tasks
    const cleaned = cleanupStaleTasks(queue);
    if (cleaned > 0) {
      await saveQueue(queue);
    }
    
    // Filter available tasks
    let available = queue.tasks.filter(t => t.status === 'pending');
    
    if (taskType) {
      available = available.filter(t => t.type === taskType);
    }
    
    // Sort by priority (critical > high > normal > low) then by creation time
    const priorityOrder = { critical: 0, high: 1, normal: 2, low: 3 };
    available.sort((a, b) => {
      const pDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (pDiff !== 0) return pDiff;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
    
    // Limit results
    available = available.slice(0, limit);
    
    return NextResponse.json({
      tasks: available.map(t => ({
        id: t.id,
        type: t.type,
        priority: t.priority,
        input: t.input,
        createdAt: t.createdAt,
      })),
      queueStats: {
        pending: queue.tasks.filter(t => t.status === 'pending').length,
        claimed: queue.tasks.filter(t => t.status === 'claimed').length,
        completed: queue.stats.totalCompleted,
        failed: queue.stats.totalFailed,
      },
    });
    
  } catch (error) {
    console.error('Failed to list tasks:', error);
    return NextResponse.json({ error: 'Failed to list tasks' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');
    const body = await request.json();
    
    const queue = await loadQueue();
    
    // ─── Claim a task ────────────────────────────────
    if (action === 'claim') {
      const { taskId, agentId } = body;
      
      if (!taskId || !agentId) {
        return NextResponse.json(
          { error: 'Missing taskId or agentId' },
          { status: 400 }
        );
      }
      
      const task = queue.tasks.find(t => t.id === taskId);
      if (!task) {
        return NextResponse.json({ error: 'Task not found' }, { status: 404 });
      }
      
      if (task.status !== 'pending') {
        return NextResponse.json(
          { error: `Task is ${task.status}, not available` },
          { status: 409 }
        );
      }
      
      // Claim the task
      task.status = 'claimed';
      task.claimedBy = agentId;
      task.claimedAt = new Date().toISOString();
      // 5 minute deadline by default
      task.deadline = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      
      await saveQueue(queue);
      
      return NextResponse.json({
        message: 'Task claimed',
        task: {
          id: task.id,
          type: task.type,
          input: task.input,
          deadline: task.deadline,
        },
      });
    }
    
    // ─── Complete a task ─────────────────────────────
    if (action === 'complete') {
      const { taskId, agentId, output, success } = body;
      
      if (!taskId || !agentId) {
        return NextResponse.json(
          { error: 'Missing taskId or agentId' },
          { status: 400 }
        );
      }
      
      const task = queue.tasks.find(t => t.id === taskId);
      if (!task) {
        return NextResponse.json({ error: 'Task not found' }, { status: 404 });
      }
      
      if (task.claimedBy !== agentId) {
        return NextResponse.json(
          { error: 'Task not claimed by this agent' },
          { status: 403 }
        );
      }
      
      if (success === false) {
        // Task failed
        task.retries++;
        if (task.retries >= task.maxRetries) {
          task.status = 'failed';
          task.output = { error: output?.error || 'Task failed' };
          task.completedAt = new Date().toISOString();
          queue.stats.totalFailed++;
        } else {
          // Reset for retry
          task.status = 'pending';
          task.claimedBy = undefined;
          task.claimedAt = undefined;
          task.deadline = undefined;
        }
      } else {
        // Task completed successfully
        task.status = 'completed';
        task.output = output;
        task.completedAt = new Date().toISOString();
        queue.stats.totalCompleted++;
      }
      
      await saveQueue(queue);
      
      return NextResponse.json({
        message: success ? 'Task completed' : 'Task failed',
        taskId: task.id,
      });
    }
    
    // ─── Create a new task ───────────────────────────
    const { type, priority, input, createdBy } = body;
    
    if (!type || !input) {
      return NextResponse.json(
        { error: 'Missing type or input' },
        { status: 400 }
      );
    }
    
    const task: Task = {
      id: randomUUID(),
      type,
      priority: priority || 'normal',
      status: 'pending',
      input,
      createdBy: createdBy || 'system',
      createdAt: new Date().toISOString(),
      retries: 0,
      maxRetries: 3,
    };
    
    queue.tasks.push(task);
    queue.stats.totalCreated++;
    await saveQueue(queue);
    
    return NextResponse.json({
      message: 'Task created',
      task: {
        id: task.id,
        type: task.type,
        priority: task.priority,
      },
    }, { status: 201 });
    
  } catch (error) {
    console.error('Failed to process task request:', error);
    return NextResponse.json({ error: 'Failed to process request' }, { status: 500 });
  }
}
