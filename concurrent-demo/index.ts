
type Task<T> = () => Promise<T>;

type TaskItem = {
  id: string;
  priority: number;
  createdAt: number;
  status: TaskStatus;
  task: Task<unknown>;
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


class CancleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CancleError";
  }
}



function makeTask(ms: number): Task<any> {
  return () =>
    new Promise((resolve) => {
      console.log(`start task ${ms}`);
      setTimeout(() => {
        console.log(`end task ${ms}`);
        resolve(ms);
      }, ms);
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
      taskItem.task().then((result) => {
        taskItem.status = "success";
        taskItem.resolve(result);
      }).catch((error) => {
        taskItem.status = "failed";
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
    if(taskItem.status !== "pending") {
      return false;
    }
    taskItem.status = "cancelled";
    taskItem.reject(new CancleError("Task cancelled"));
    this.queue = this.queue.filter((item) => item.id !== taskId);
    return true;
  }
}