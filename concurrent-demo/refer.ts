// import { pathToFileURL } from "node:url";

// export type TaskStatus =
//   | "pending"
//   | "running"
//   | "success"
//   | "failed"
//   | "cancelled"
//   | "timeout";

// export type TaskContext = {
//   signal: AbortSignal;
//   taskId: string;
//   attempt: number;
// };

// export type TaskFn<T> = (ctx: TaskContext) => Promise<T> | T;

// export type SchedulerOptions = {
//   concurrency: number;
//   defaultTimeout?: number;
//   defaultRetries?: number;
// };

// export type AddTaskOptions = {
//   id?: string;
//   priority?: number;
//   timeout?: number;
//   retries?: number;
// };

// export type TaskInfo = {
//   id: string;
//   status: TaskStatus;
//   priority: number;
//   attempt: number;
//   retries: number;
//   timeout?: number;
//   createdAt: number;
//   updatedAt: number;
//   error?: unknown;
// };

// export type SchedulerSnapshot = {
//   paused: boolean;
//   concurrency: number;
//   runningCount: number;
//   pendingCount: number;
//   runningIds: string[];
//   pendingIds: string[];
//   tasks: TaskInfo[];
// };

// type InternalTask<T> = {
//   id: string;
//   fn: TaskFn<T>;
//   priority: number;
//   sequence: number;
//   createdAt: number;
//   updatedAt: number;
//   status: TaskStatus;
//   attempt: number;
//   retries: number;
//   timeout?: number;
//   controller: AbortController;
//   resolve: (value: T) => void;
//   reject: (reason: unknown) => void;
//   error?: unknown;
// };

// export class CancelError extends Error {
//   constructor(taskId: string) {
//     super(`Task ${taskId} was cancelled`);
//     this.name = "CancelError";
//   }
// }

// export class TimeoutError extends Error {
//   constructor(taskId: string, timeout: number) {
//     super(`Task ${taskId} timed out after ${timeout}ms`);
//     this.name = "TimeoutError";
//   }
// }

// export class DuplicateTaskIdError extends Error {
//   constructor(taskId: string) {
//     super(`Task id ${taskId} already exists`);
//     this.name = "DuplicateTaskIdError";
//   }
// }

// export class TaskScheduler {
//   private readonly concurrency: number;
//   private readonly defaultTimeout?: number;
//   private readonly defaultRetries: number;

//   private paused = false;
//   private nextId = 1;
//   private nextSequence = 1;
//   private queue: InternalTask<unknown>[] = [];
//   private running = new Map<string, InternalTask<unknown>>();
//   private tasks = new Map<string, InternalTask<unknown>>();

//   constructor(options: SchedulerOptions) {
//     if (!Number.isInteger(options.concurrency) || options.concurrency <= 0) {
//       throw new Error("concurrency must be a positive integer");
//     }

//     this.concurrency = options.concurrency;
//     this.defaultTimeout = options.defaultTimeout;
//     this.defaultRetries = options.defaultRetries ?? 0;
//   }

//   addTask<T>(fn: TaskFn<T>, options: AddTaskOptions = {}): Promise<T> {
//     const id = options.id ?? `task-${this.nextId++}`;

//     if (this.tasks.has(id)) {
//       return Promise.reject(new DuplicateTaskIdError(id));
//     }

//     const task: InternalTask<T> = {
//       id,
//       fn,
//       priority: options.priority ?? 0,
//       sequence: this.nextSequence++,
//       createdAt: Date.now(),
//       updatedAt: Date.now(),
//       status: "pending",
//       attempt: 0,
//       retries: options.retries ?? this.defaultRetries,
//       timeout: options.timeout ?? this.defaultTimeout,
//       controller: new AbortController(),
//       resolve: () => undefined,
//       reject: () => undefined,
//     };

//     const result = new Promise<T>((resolve, reject) => {
//       task.resolve = resolve;
//       task.reject = reject;
//     });

//     this.tasks.set(id, task as InternalTask<unknown>);
//     this.enqueue(task as InternalTask<unknown>);
//     this.schedule();

//     return result;
//   }

//   cancel(taskId: string): boolean {
//     const task = this.tasks.get(taskId);

//     if (!task || this.isSettled(task.status)) {
//       return false;
//     }

//     const error = new CancelError(taskId);

//     if (task.status === "pending") {
//       this.removeFromQueue(taskId);
//       this.finishTask(task, "cancelled", error);
//       return true;
//     }

//     if (task.status === "running") {
//       task.status = "cancelled";
//       task.updatedAt = Date.now();
//       task.error = error;
//       task.controller.abort(error);
//       return true;
//     }

//     return false;
//   }

//   pause(): void {
//     this.paused = true;
//   }

//   resume(): void {
//     if (!this.paused) return;
//     this.paused = false;
//     this.schedule();
//   }

//   getStatus(taskId: string): TaskStatus | undefined {
//     return this.tasks.get(taskId)?.status;
//   }

//   getTaskInfo(taskId: string): TaskInfo | undefined {
//     const task = this.tasks.get(taskId);
//     return task ? this.toTaskInfo(task) : undefined;
//   }

//   getSnapshot(): SchedulerSnapshot {
//     return {
//       paused: this.paused,
//       concurrency: this.concurrency,
//       runningCount: this.running.size,
//       pendingCount: this.queue.length,
//       runningIds: Array.from(this.running.keys()),
//       pendingIds: this.queue.map((task) => task.id),
//       tasks: Array.from(this.tasks.values()).map((task) => this.toTaskInfo(task)),
//     };
//   }

//   private schedule(): void {
//     if (this.paused) return;

//     while (this.running.size < this.concurrency && this.queue.length > 0) {
//       const task = this.queue.shift();
//       if (!task || task.status !== "pending") continue;

//       void this.runTask(task);
//     }
//   }

//   private async runTask(task: InternalTask<unknown>): Promise<void> {
//     task.status = "running";
//     task.attempt += 1;
//     task.updatedAt = Date.now();
//     task.error = undefined;
//     task.controller = new AbortController();
//     this.running.set(task.id, task);

//     try {
//       const result = await this.runAttempt(task);

//       if (this.tasks.get(task.id)?.status === "cancelled") {
//         this.finishTask(task, "cancelled", task.error ?? new CancelError(task.id));
//         return;
//       }

//       this.finishTask(task, "success", undefined, result);
//     } catch (error) {
//       this.handleTaskError(task, error);
//     } finally {
//       this.running.delete(task.id);
//       this.schedule();
//     }
//   }

//   private async runAttempt(task: InternalTask<unknown>): Promise<unknown> {
//     if (task.timeout === undefined) {
//       return task.fn({
//         signal: task.controller.signal,
//         taskId: task.id,
//         attempt: task.attempt,
//       });
//     }

//     return new Promise((resolve, reject) => {
//       let settled = false;

//       const settle = (
//         callback: (value: unknown) => void,
//         value: unknown,
//       ): void => {
//         if (settled) return;
//         settled = true;
//         clearTimeout(timer);
//         callback(value);
//       };

//       const timer = setTimeout(() => {
//         const error = new TimeoutError(task.id, task.timeout!);
//         task.controller.abort(error);
//         settle(reject, error);
//       }, task.timeout);

//       Promise.resolve(
//         task.fn({
//           signal: task.controller.signal,
//           taskId: task.id,
//           attempt: task.attempt,
//         }),
//       ).then(
//         (value) => settle(resolve, value),
//         (error) => settle(reject, error),
//       );
//     });
//   }

//   private handleTaskError(task: InternalTask<unknown>, error: unknown): void {
//     if (task.status === "cancelled" || error instanceof CancelError) {
//       this.finishTask(task, "cancelled", task.error ?? error);
//       return;
//     }

//     const status: TaskStatus = error instanceof TimeoutError ? "timeout" : "failed";
//     const canRetry = task.attempt <= task.retries;

//     if (canRetry) {
//       task.status = "pending";
//       task.updatedAt = Date.now();
//       task.error = error;
//       this.enqueue(task);
//       return;
//     }

//     this.finishTask(task, status, error);
//   }

//   private enqueue(task: InternalTask<unknown>): void {
//     this.queue.push(task);
//     this.queue.sort((a, b) => {
//       if (a.priority !== b.priority) {
//         return b.priority - a.priority;
//       }

//       return a.sequence - b.sequence;
//     });
//   }

//   private finishTask(
//     task: InternalTask<unknown>,
//     status: TaskStatus,
//     error?: unknown,
//     result?: unknown,
//   ): void {
//     task.status = status;
//     task.updatedAt = Date.now();
//     task.error = error;

//     if (status === "success") {
//       task.resolve(result);
//       return;
//     }

//     task.reject(error);
//   }

//   private removeFromQueue(taskId: string): void {
//     this.queue = this.queue.filter((task) => task.id !== taskId);
//   }

//   private isSettled(status: TaskStatus): boolean {
//     return (
//       status === "success" ||
//       status === "failed" ||
//       status === "cancelled" ||
//       status === "timeout"
//     );
//   }

//   private toTaskInfo(task: InternalTask<unknown>): TaskInfo {
//     return {
//       id: task.id,
//       status: task.status,
//       priority: task.priority,
//       attempt: task.attempt,
//       retries: task.retries,
//       timeout: task.timeout,
//       createdAt: task.createdAt,
//       updatedAt: task.updatedAt,
//       error: task.error,
//     };
//   }
// }

// export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
//   return new Promise((resolve, reject) => {
//     if (signal?.aborted) {
//       reject(signal.reason ?? new CancelError("unknown"));
//       return;
//     }

//     const timer = setTimeout(resolve, ms);

//     signal?.addEventListener(
//       "abort",
//       () => {
//         clearTimeout(timer);
//         reject(signal.reason ?? new CancelError("unknown"));
//       },
//       { once: true },
//     );
//   });
// }

// async function demo(): Promise<void> {
//   const scheduler = new TaskScheduler({
//     concurrency: 2,
//     defaultTimeout: 1500,
//     defaultRetries: 1,
//   });

//   const createTask =
//     (duration: number, failAtAttempts: number[] = []): TaskFn<string> =>
//     async ({ signal, taskId, attempt }) => {
//       console.log(`[start] ${taskId}, attempt=${attempt}`);
//       await sleep(duration, signal);

//       if (failAtAttempts.includes(attempt)) {
//         throw new Error(`${taskId} failed at attempt ${attempt}`);
//       }

//       console.log(`[done] ${taskId}, attempt=${attempt}`);
//       return `${taskId} result`;
//     };

//   const tasks = [
//     scheduler.addTask(createTask(800), { id: "normal-1", priority: 1 }),
//     scheduler.addTask(createTask(600, [1]), {
//       id: "retry-success",
//       priority: 5,
//       retries: 2,
//     }),
//     scheduler.addTask(createTask(3000), {
//       id: "timeout-then-retry",
//       priority: 3,
//       timeout: 700,
//       retries: 1,
//     }),
//     scheduler.addTask(createTask(1000), { id: "will-cancel", priority: 2 }),
//   ];

//   scheduler.cancel("will-cancel");

//   console.log("[snapshot after add]", scheduler.getSnapshot());

//   const results = await Promise.allSettled(tasks);

//   console.log("[results]", results);
//   console.log("[final snapshot]", scheduler.getSnapshot());
// }

// if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
//   void demo();
// }
