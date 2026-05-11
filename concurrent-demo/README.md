# 多任务并发调度器 Demo 训练 README

> 目标：通过分阶段训练，最终独立写出一个支持 **最大并发数、任务队列、优先级、取消、超时、重试、暂停/恢复、状态快照** 的完整多任务并发调度器。

这个项目不是为了背代码，而是为了训练你从需求出发，逐步建立：

```txt
需求 → 契约 → 流程 → 状态 → 边界 → 实现 → 测试
```

---

## 0. 项目最终形态

最终你要实现一个类似这样的调度器：

```ts
const scheduler = new TaskScheduler({
  concurrency: 3,
  defaultTimeout: 3000,
  defaultRetries: 1,
});

const p1 = scheduler.addTask(async ({ signal, attempt }) => {
  const res = await fetch('/api/list', { signal });
  return res.json();
}, {
  id: 'task-1',
  priority: 10,
  timeout: 5000,
  retries: 2,
});

scheduler.cancel('task-1');
scheduler.pause();
scheduler.resume();

console.log(scheduler.getSnapshot());
```

最终能力包括：

* 限制最大并发数
* 任务排队
* 任务完成后自动调度下一个任务
* `addTask` 返回任务结果 Promise
* 支持任务优先级
* 支持取消 pending / running 任务
* 支持任务超时
* 支持任务失败后重试
* 支持暂停 / 恢复
* 支持任务状态查询
* 支持调度器状态快照

---

# 第一阶段：最小并发调度器

## 目标

先不要考虑取消、重试、超时、优先级。

只实现：

```txt
有 N 个异步任务，最多同时运行 concurrency 个。
某个任务完成后，自动启动下一个任务。
```

---

## 需求描述

假设有 5 个任务：

```txt
task1: 1000ms
task2: 2000ms
task3: 1500ms
task4: 800ms
task5: 1200ms
```

并发数为 2。

那么一开始只能执行：

```txt
task1, task2
```

当 task1 完成后，再执行 task3。

当 task2 完成后，再执行 task4。

始终保持：

```txt
runningCount <= concurrency
```

---

## 对外契约

先设计最小 API：

```ts
class TaskScheduler {
  constructor(concurrency: number);

  addTask<T>(task: () => Promise<T>): Promise<T>;
}
```

此时只需要关心一个问题：

> `addTask` 为什么要返回 Promise？

答案：因为任务可能不会立刻执行，但调用方最终需要拿到这个任务的结果。

---

## 内部状态

第一阶段只需要两个核心状态：

```ts
private queue: InternalTask[] = [];
private runningCount = 0;
```

你要能解释：

```txt
queue 里面放的是还没开始的任务。
runningCount 表示当前正在运行的任务数量。
```

---

## 核心流程

```txt
addTask
  -> 包装任务
  -> queue.push(task)
  -> schedule()

schedule
  -> 如果 runningCount < concurrency
  -> 从 queue 取出任务
  -> runningCount++
  -> 执行任务
  -> 任务完成后 runningCount--
  -> 再次 schedule()
```

---

## 验收标准

你应该能做到：

* 添加 5 个任务
* 设置并发数为 2
* 控制台最多同时出现 2 个 running
* 每个任务都能最终 resolve
* 任意任务完成后，可以自动补位下一个任务

---

## 你要问自己的问题

1. 任务为什么不是直接执行，而是先入队？
2. `schedule` 为什么需要在 `addTask` 之后调用？
3. `schedule` 为什么需要在任务完成后再次调用？
4. 为什么不能只用一个 `for` 循环把任务全部启动？
5. `addTask` 返回的 Promise 是谁 resolve 的？

---

# 第二阶段：把 runningCount 升级为 running Map

## 目标

第一阶段只能知道有几个任务正在运行，但不知道具体是谁在运行。

第二阶段要支持：

```ts
getSnapshot();
```

能看到：

```ts
{
  concurrency: 2,
  runningCount: 2,
  pendingCount: 3,
  runningIds: ['task-1', 'task-2'],
  pendingIds: ['task-3', 'task-4', 'task-5']
}
```

---

## 新增契约

```ts
class TaskScheduler {
  addTask<T>(task: () => Promise<T>, options?: { id?: string }): Promise<T>;

  getSnapshot(): {
    concurrency: number;
    runningCount: number;
    pendingCount: number;
    runningIds: string[];
    pendingIds: string[];
  };
}
```

---

## 内部状态变化

从：

```ts
private runningCount = 0;
```

升级为：

```ts
private running = new Map<string, InternalTask>();
```

因为后续要支持：

* 取消某个任务
* 查询某个任务状态
* 快照展示
* 调试任务生命周期

---

## 验收标准

你应该能做到：

* 每个任务都有 id
* running 中能看到正在执行的任务
* queue 中能看到等待执行的任务
* 任务完成后，会从 running 中删除

---

## 你要问自己的问题

1. 为什么 `runningCount` 不够用了？
2. 为什么 running 用 Map，而不是数组？
3. taskId 应该由用户传，还是调度器自动生成？
4. 如果用户传了重复 id，应该怎么处理？

---

# 第三阶段：任务状态机

## 目标

给每个任务增加明确状态。

```ts
type TaskStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'failed';
```

---

## 为什么需要状态？

因为后面要处理取消、重试、超时。

如果没有状态，你会说不清楚：

```txt
这个任务现在到底是没开始？正在跑？成功了？失败了？被取消了？超时了？
```

---

## 新增契约

```ts
getStatus(taskId: string): TaskStatus | undefined;
```

---

## 生命周期

```txt
pending
  -> running
  -> success

pending
  -> running
  -> failed
```

---

## 验收标准

你应该能做到：

* addTask 后状态是 pending
* 被调度执行后状态是 running
* 成功后状态是 success
* 失败后状态是 failed
* 可以通过 getStatus 查询状态

---

## 你要问自己的问题

1. 成功后的任务还要不要留在 taskMap 里？
2. 失败后的任务还要不要留在 taskMap 里？
3. 如果删除了，`getStatus` 查不到是否合理？
4. 如果保留了，会不会造成内存一直增长？

建议：

教学版可以先保留，方便观察。

工程版可以成功/失败后删除，或者只保留有限历史记录。

---

# 第四阶段：优先级队列

## 目标

支持任务优先级：

```ts
scheduler.addTask(task, {
  id: 'task-a',
  priority: 10,
});

scheduler.addTask(task, {
  id: 'task-b',
  priority: 1,
});
```

priority 越大，越早执行。

---

## 新增契约

```ts
addTask<T>(
  task: () => Promise<T>,
  options?: {
    id?: string;
    priority?: number;
  }
): Promise<T>;
```

---

## 内部状态变化

InternalTask 增加：

```ts
interface InternalTask<T> {
  id: string;
  fn: () => Promise<T>;
  priority: number;
  createdAt: number;
  status: TaskStatus;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}
```

排序规则：

```txt
优先级高的在前。
如果优先级一样，创建时间早的在前。
```

---

## 核心注意点

优先级只影响：

```txt
还没开始的 pending 任务
```

不能影响：

```txt
已经 running 的任务
```

也就是说，高优先级任务不会抢占已经运行中的低优先级任务。

---

## 验收标准

你应该能做到：

* concurrency = 1 时，优先级高的 pending 任务先执行
* 同优先级任务按加入顺序执行
* 已经 running 的任务不会被打断

---

## 你要问自己的问题

1. 为什么优先级只影响 queue，不影响 running？
2. 如果要支持抢占式优先级，需要增加什么机制？
3. 每次 addTask 后都 sort 是否可以接受？
4. 如果任务很多，是否需要真正的堆结构优先级队列？

---

# 第五阶段：取消 pending 任务

## 目标

先只支持取消还没开始的任务。

```ts
scheduler.cancel('task-1');
```

如果 task-1 还在 queue 里，就：

```txt
从 queue 移除
状态变成 cancelled
对应 Promise reject
```

---

## 新增状态

```ts
type TaskStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'failed'
  | 'cancelled';
```

---

## 新增契约

```ts
cancel(taskId: string): boolean;
```

返回值含义：

```txt
true: 找到了，并且尝试取消了
false: 没找到，或者已经无法取消
```

---

## pending 取消流程

```txt
cancel(taskId)
  -> 找 taskMap
  -> 如果状态是 pending
  -> 从 queue 删除
  -> task.status = cancelled
  -> task.reject(new CancelError())
```

---

## 验收标准

你应该能做到：

* 取消还没开始的任务
* 被取消的任务不会执行
* addTask 返回的 Promise 会 reject
* cancel 不存在的任务返回 false

---

## 你要问自己的问题

1. 取消 pending 任务时，为什么要 reject Promise？
2. 取消后是否要从 taskMap 删除？
3. 如果取消后不 reject，会发生什么？
4. 如果调用方没写 catch，会发生什么？

---

# 第六阶段：取消 running 任务

## 目标

支持取消正在运行的任务。

这一步要引入：

```ts
AbortController
AbortSignal
```

---

## 重要认知

取消 running 任务不是强制杀死 JS 函数。

它是协作式取消：

```txt
调度器发出取消信号。
任务内部自己响应这个信号。
```

---

## 任务函数契约升级

从：

```ts
type TaskFn<T> = () => Promise<T>;
```

升级为：

```ts
type TaskFn<T> = (ctx: {
  signal: AbortSignal;
  taskId: string;
}) => Promise<T>;
```

---

## InternalTask 增加 controller

```ts
interface InternalTask<T> {
  id: string;
  fn: TaskFn<T>;
  controller: AbortController;
}
```

执行任务时传入 signal：

```ts
task.fn({
  signal: task.controller.signal,
  taskId: task.id,
});
```

取消 running 任务时：

```ts
task.controller.abort();
```

---

## 支持取消的 sleep

```ts
function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);

    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    });
  });
}
```

---

## 验收标准

你应该能做到：

* 取消 running 任务
* running 任务内部能感知 signal.aborted
* 被取消的任务 Promise reject
* 取消后 running Map 能正确删除
* 取消后能继续调度下一个任务

---

## 你要问自己的问题

1. 为什么 AbortController 不是强制取消？
2. 如果任务内部不监听 signal，会发生什么？
3. running 任务被 cancel 后，状态什么时候改成 cancelled？
4. abort 后 Promise reject 是谁触发的？
5. cancel running 后为什么还要等待任务内部抛错？

---

# 第七阶段：超时 timeout

## 目标

支持任务超时。

```ts
scheduler.addTask(task, {
  timeout: 3000,
});
```

如果任务 3 秒内没有完成，则：

```txt
abort 任务
状态变成 timeout
Promise reject TimeoutError
```

---

## 新增状态

```ts
type TaskStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'failed'
  | 'cancelled'
  | 'timeout';
```

---

## runWithTimeout

你可以单独封装：

```ts
private runWithTimeout<T>(task: InternalTask<T>): Promise<T> {
  // 负责 Promise.race 或 setTimeout 包装
}
```

推荐先用 setTimeout 包装，而不是一上来就 Promise.race。

因为 setTimeout 版本更容易理解：

```txt
启动任务
同时启动定时器
谁先结束，就处理谁
任务结束后清除定时器
```

---

## 超时流程

```txt
runTask
  -> runWithTimeout
  -> timeout 到达
  -> controller.abort()
  -> reject TimeoutError
  -> handleTaskError
```

---

## 验收标准

你应该能做到：

* 任务超过 timeout 后会 reject
* timeout 后任务状态为 timeout
* timeout 后会释放 running 槽位
* timeout 后会继续调度下一个任务
* 任务提前完成时，timeout 定时器会被清理

---

## 你要问自己的问题

1. 超时本质上是不是一种自动取消？
2. timeout 后为什么也要 abort？
3. 如果任务内部不响应 abort，调度器会怎样？
4. timeout 的 Promise reject 和任务本身后续 resolve 谁优先？
5. clearTimeout 应该放在哪里？

---

# 第八阶段：失败重试 retry

## 目标

支持任务失败后重试。

```ts
scheduler.addTask(task, {
  retries: 2,
});
```

含义：

```txt
最多额外重试 2 次。
总执行次数最多 3 次。
```

---

## InternalTask 增加 attempt

```ts
interface InternalTask<T> {
  attempt: number;
  retries: number;
}
```

每次真正执行时：

```ts
task.attempt += 1;
```

---

## retry 流程

```txt
runTask 失败
  -> handleTaskError
  -> 如果 attempt <= retries
  -> 状态改回 pending
  -> 重新入队
  -> schedule
```

---

## 关键边界

如果任务因为 cancel 失败，一般不应该 retry。

如果任务因为 timeout 失败，是否 retry 由你设计决定。

教学版建议：

```txt
普通失败：可以 retry
超时失败：可以 retry
主动取消：不 retry
```

---

## 为什么重试要重新 new AbortController？

因为 AbortController 一旦 abort，就不能恢复。

```ts
const controller = new AbortController();
controller.abort();
console.log(controller.signal.aborted); // true
```

所以重试前必须：

```ts
task.controller = new AbortController();
```

---

## 验收标准

你应该能做到：

* 第一次失败后可以自动重试
* attempt 数正确增加
* 超过 retries 后最终 failed
* 重试成功后最终 success
* 取消的任务不会重试
* 超时后如果设计为可重试，则每次重试都用新的 signal

---

## 你要问自己的问题

1. retries = 2 表示总共执行几次？
2. attempt 应该在什么时候加一？
3. 重试时任务是立即执行，还是重新排队？
4. 重试是否应该保留原来的 priority？
5. 为什么取消不应该重试？

---

# 第九阶段：暂停 / 恢复

## 目标

支持调度器暂停和恢复。

```ts
scheduler.pause();
scheduler.resume();
```

---

## 重要认知

暂停不是停止正在运行的任务。

暂停只表示：

```txt
不要再启动新的任务。
```

已经 running 的任务继续运行。

---

## 新增状态

```ts
private paused = false;
```

schedule 开头增加：

```ts
if (this.paused) return;
```

---

## 流程

```txt
pause
  -> paused = true

任务完成
  -> finally
  -> schedule
  -> 因为 paused，所以不会启动新任务

resume
  -> paused = false
  -> schedule
```

---

## 验收标准

你应该能做到：

* pause 后不会启动新的 pending 任务
* pause 不影响已经 running 的任务
* resume 后继续调度 pending 任务
* 多次 pause / resume 不出错

---

## 你要问自己的问题

1. pause 是否应该 abort running 任务？
2. pause 和 cancelAll 有什么区别？
3. resume 为什么要主动调用 schedule？
4. 如果 pause 时 runningCount 还有任务，任务完成后会发生什么？

---

# 第十阶段：完整 API 收口

## 目标

把所有能力整理成最终版 API。

---

## 推荐最终 API

```ts
type TaskStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'failed'
  | 'cancelled'
  | 'timeout';

interface TaskContext {
  signal: AbortSignal;
  taskId: string;
  attempt: number;
}

type TaskFn<T> = (ctx: TaskContext) => Promise<T> | T;

interface SchedulerOptions {
  concurrency: number;
  defaultTimeout?: number;
  defaultRetries?: number;
}

interface AddTaskOptions {
  id?: string;
  priority?: number;
  timeout?: number;
  retries?: number;
}

class TaskScheduler {
  constructor(options: SchedulerOptions);

  addTask<T>(fn: TaskFn<T>, options?: AddTaskOptions): Promise<T>;

  cancel(taskId: string): boolean;

  pause(): void;

  resume(): void;

  getStatus(taskId: string): TaskStatus | undefined;

  getSnapshot(): {
    paused: boolean;
    concurrency: number;
    runningCount: number;
    pendingCount: number;
    runningIds: string[];
    pendingIds: string[];
  };
}
```

---

# 第十一阶段：测试用例设计

## 1. 并发测试

```txt
concurrency = 2
添加 5 个任务
任何时刻 running 不能超过 2
```

---

## 2. 优先级测试

```txt
concurrency = 1
先添加低优先级任务
再添加高优先级任务
如果低优先级已经 running，则不抢占
如果还在 pending，则高优先级先执行
```

---

## 3. pending 取消测试

```txt
添加多个任务
取消还没开始的任务
它不应该被执行
Promise 应该 reject
```

---

## 4. running 取消测试

```txt
启动一个长任务
运行中 cancel
任务内部监听 signal
Promise reject
槽位释放
下一个任务启动
```

---

## 5. timeout 测试

```txt
任务 sleep 5000ms
timeout = 1000ms
最终应该 timeout
```

---

## 6. retry 测试

```txt
任务前两次失败
第三次成功
retries = 2
最终应该 resolve
```

---

## 7. retry 失败测试

```txt
任务一直失败
retries = 2
最终执行 3 次
最后 reject
```

---

## 8. pause / resume 测试

```txt
concurrency = 2
添加 5 个任务
pause
正在运行的任务继续完成
但不会启动新的任务
resume 后继续执行
```

---

# 第十二阶段：你真正手写时的顺序

不要从完整代码开始写。

请按这个顺序手写：

```txt
1. addTask + queue + schedule
2. running Map + snapshot
3. status 状态机
4. priority 排序
5. cancel pending
6. cancel running + AbortController
7. timeout
8. retry
9. pause / resume
10. 整理类型和测试 demo
```

每写完一个阶段，都问自己：

```txt
这个阶段新增了什么契约？
新增了什么状态？
改变了什么流程？
引入了什么边界？
```

---

# 最小练习模板

每个阶段都可以用这个模板思考：

```txt
## 当前阶段目标
我要新增什么能力？

## 对外契约
用户怎么调用？
返回什么？
异常怎么处理？

## 内部状态
为了支持这个能力，我需要新增什么状态？

## 主流程
从 addTask 到任务结束，中间发生了什么？

## 边界情况
任务失败怎么办？
任务还没开始怎么办？
任务已经结束怎么办？
重复调用怎么办？

## 验收方式
我如何证明它真的工作了？
```

---

# 最终你应该形成的心智模型

一个并发调度器不是一段复杂代码。

它本质上是：

```txt
一个队列
一个 running 集合
一个 schedule 函数
一套任务状态机
一套异常和边界处理规则
```

其中最核心的是：

```txt
schedule 只负责启动任务。
runTask 只负责执行任务。
handleTaskError 只负责失败分支。
cancel 只负责改变任务生命周期。
```

当你能把这几个职责分清楚，你就不是在背实现，而是在设计一个小型运行时。
