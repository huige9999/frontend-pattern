
type Task<T> = (ctx: {
  signal: AbortSignal;
  taskId: string;
}) => Promise<T>;

type TaskItem = {
  id: string;
  priority: number;
  createdAt: number;
  status: TaskStatus;
  task: Task<unknown>;
  controller: AbortController;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
};

type Snapshot = {
  concurrency: number;
  runningCount: number;
  pendingCount: number;
  runningIds: string[];
  pendingIds: string[];
};

type TaskStatus = "pending" | "running" | "success" | "failed" | "cancelled";


class CancelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CancelError";
  }
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    });
  });
}



export class TaskScheduler {
  private readonly concurrency: number;
  private queue: TaskItem[] = [];
  private running = new Map<string, TaskItem>();
  private taskMap = new Map<string, TaskItem>();
  private nextId = 1;

  constructor(concurrency: number) {
    this.concurrency = concurrency;
  }

  private get runningCount() {
    return this.running.size;
  }

  private get pendingCount() {
    return this.queue.length;
  }

  private get runningIds() {
    return Array.from(this.running.keys());
  }

  private get pendingIds() {
    return this.queue.map(({ id }) => id);
  }

  addTask<T>(_task: Task<T>, options?: { id?: string, priority?: number }): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = options?.id ?? `task-${this.nextId++}`;
      // 判断id是否已经存在
      if (this.taskMap.has(id)) {
        reject(new Error(`Task id ${id} already exists`));
        return;
      }
      const taskItem: TaskItem = {
        id,
        priority: options?.priority ?? 0,
        createdAt: Date.now(),
        task: _task,
        status: "pending",
        resolve: resolve as (value: unknown) => void,
        reject,
        controller: new AbortController()
      };
      this.queue.push(taskItem);
      this.queue.sort((a, b) => {
        if (a.priority !== b.priority) {
          return b.priority - a.priority;
        }
        return a.createdAt - b.createdAt;
      });
      this.taskMap.set(id, taskItem);
      this.schedule();
    });
  }

  getStatus(taskId: string): TaskStatus | undefined {
    return this.taskMap.get(taskId)?.status;
  }

  private schedule(): void {
    while (this.runningCount < this.concurrency && this.queue.length > 0) {
      const taskItem = this.queue.shift()!;
      taskItem.status = "running";
      this.running.set(taskItem.id, taskItem);
      this.taskMap.set(taskItem.id, taskItem);
      taskItem.task({
        signal: taskItem.controller.signal,
        taskId: taskItem.id
      }).then((result) => {
        taskItem.status = "success";
        taskItem.resolve(result);
      }).catch((error) => {
        taskItem.status = error.message === "aborted" ? "cancelled" : "failed";
        taskItem.reject(error);
      }).finally(() => {
        this.running.delete(taskItem.id);
        this.schedule();
      });
    }
  }

  getSnapshot(): Snapshot {
    return {
      concurrency: this.concurrency,
      runningCount: this.runningCount,
      pendingCount: this.pendingCount,
      runningIds: this.runningIds,
      pendingIds: this.pendingIds,
    };
  }

  cancel(taskId: string):boolean {
    const taskItem = this.taskMap.get(taskId);
    if(!taskItem) {
      return false;
    }
    if(taskItem.status === "running") {
      taskItem.controller.abort();
      return true;
    }
    if(taskItem.status === "pending") {
      taskItem.status = "cancelled";
      taskItem.reject(new CancelError("Task cancelled"));
      this.queue = this.queue.filter((item) => item.id !== taskId);
      return true;
    }
    return false;
  }
}

const taskScheduler = new TaskScheduler(2);

taskScheduler.addTask(async ({ signal, taskId }) => {
  await sleep(1000, signal);
  return `task ${taskId} completed`;
}).then((result) => {
  console.log(result);
}).catch((error) => {
  console.error(error);
});

taskScheduler.cancel("task-1");