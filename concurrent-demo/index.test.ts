import { describe, expect, it } from 'vitest'
import { TaskScheduler } from './index.js'

describe('TaskScheduler', () => {
    it('添加一个异步任务并返回任务的结果', async () => {
        const scheduler = new TaskScheduler({concurrency: 1})

        const result = await scheduler.addTask(async () => 42)

        expect(result).toBe(42)
    })

    it('并发数为2时，同时添加3个任务，最多只有2个任务同时运行', async () => {
        const scheduler = new TaskScheduler({ concurrency: 2 })

        let runningCount = 0
        let maxRunningCount = 0

        const createTask = (id: number) => async () => {
            runningCount++
            maxRunningCount = Math.max(maxRunningCount, runningCount)
            await new Promise(resolve => setTimeout(resolve, 100))
            runningCount--
            return id
        }

        const results = await Promise.all([
            scheduler.addTask(createTask(1)),
            scheduler.addTask(createTask(2)),
            scheduler.addTask(createTask(3)),
        ])

        expect(maxRunningCount).toBeLessThanOrEqual(2)
        expect(results).toEqual([1, 2, 3])
    })

    it('暂停后队列中的任务不再执行，恢复后继续执行', async () => {
        const scheduler = new TaskScheduler({ concurrency: 1 })

        const executionOrder: number[] = []

        const createTask = (id: number) => async () => {
            executionOrder.push(id)
            await new Promise(resolve => setTimeout(resolve, 50))
            return id
        }

        // 第一个任务会立即开始执行
        const p1 = scheduler.addTask(createTask(1))
        // 第二个任务进入队列等待
        const p2 = scheduler.addTask(createTask(2))
        // 第三个任务进入队列等待
        const p3 = scheduler.addTask(createTask(3))

        // 暂停调度器，此时任务1正在执行，任务2、3在队列中
        scheduler.pause()

        await p1

        // 等待一小段时间，确认暂停后队列任务没有被执行
        await new Promise(resolve => setTimeout(resolve, 100))
        expect(executionOrder).toEqual([1])

        // 恢复调度器，队列中的任务应该继续执行
        scheduler.resume()

        await Promise.all([p2, p3])
        expect(executionOrder).toEqual([1, 2, 3])
    })
})