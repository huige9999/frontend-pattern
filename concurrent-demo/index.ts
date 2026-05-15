
type Task<T> = () => Promise<T>


type TaskItem = {
  id: string;
  status: TaskStatus;
  task: Task<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

type Snapshot = {
  concurrency: number;
  runningCount: number;
  pendingCount: number;
  runningIds: string[];
  pendingIds: string[];
}

type TaskStatus = 'pending' | 'running' | 'success' | 'failed'


function makeTask(ms: number):Task<any> {
  return () => new Promise((resolve) => {
    console.log(`start task ${ms}`);
    setTimeout(() => {
      console.log(`end task ${ms}`);
      resolve(ms);
    }, ms);
  })
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
    return this.queue.map(({id}) =>  id);
  }

  addTask<T>(_task: Task<T>, options?: { id?: string }): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = options?.id ?? `task-${this.nextId++}`;
      // 判断id是否已经存在
      if (this.taskMap.has(id)) {
        reject(new Error(`Task id ${id} already exists`));
        return;
      }
      const taskItem: TaskItem = {
        id,
        task: _task,
        status: 'pending',
        resolve: resolve as (value: unknown) => void,
        reject,
      }
      this.queue.push(taskItem)
      this.taskMap.set(id, taskItem);
      this.schedule();
    })
  }

  getStatus(taskId: string): TaskStatus | undefined {
    return this.taskMap.get(taskId)?.status;
  }

  private schedule(): void {
    while(this.runningCount < this.concurrency && this.queue.length > 0) {
        const { id, task, resolve, reject } = this.queue.shift()!;
        const taskItem = {
          id,
          task,
          status: 'running',
          resolve,
          reject,
        }
        this.running.set(id, taskItem as TaskItem);
        this.taskMap.set(id, taskItem as TaskItem);

        task().then((result) => {
          this.running.delete(id);
          this.taskMap.get(id)!.status = 'success';
          resolve(result);
        }).catch((error) => {
          this.running.delete(id);
          this.taskMap.get(id)!.status = 'failed';
          reject(error);
        }).finally(() => {
          this.running.delete(id);
          this.schedule();
        })
    }

  }

  getSnapshot():Snapshot {
    return {
      concurrency: this.concurrency,
      runningCount: this.runningCount,
      pendingCount: this.pendingCount,
      runningIds: this.runningIds,
      pendingIds: this.pendingIds,
    }
  }
}


const taskScheduler = new TaskScheduler(2);

const task1 = taskScheduler.addTask(makeTask(1000), { id: 'task-1' })
const task2 = taskScheduler.addTask(makeTask(1000), { id: 'task-2' })
const task3 = taskScheduler.addTask(makeTask(1000), { id: 'task-3' })
const task4 = taskScheduler.addTask(makeTask(1000), { id: 'task-4' })
const task5 = taskScheduler.addTask(makeTask(1000), { id: 'task-5' })

console.log('after add:',taskScheduler.getStatus('task-1'));

Promise.all([task1, task2, task3, task4, task5]).then(() => {
  console.log('after all:',taskScheduler.getStatus('task-1'));
});