import Enquirer from 'enquirer'

import { PromptInstance, PromptOptions, PromptSettings } from './prompt.interface'
import { PromptError } from '@interfaces/listr.interface'
import { stateConstants } from '@root/interfaces/state.constants'
import { TaskWrapper } from '@root/lib/task-wrapper'

export async function createPrompt (this: TaskWrapper<any, any>, options: PromptOptions | PromptOptions<true>[], settings?: PromptSettings): Promise<any> {
  // override cancel callback
  let cancelCallback: PromptSettings['cancelCallback']
  /* istanbul ignore if */
  if (settings?.cancelCallback) {
    cancelCallback = settings.cancelCallback
  } else {
    cancelCallback = defaultCancelCallback
  }

  // assign default if there is single prompt
  /* istanbul ignore else if */
  if (!Array.isArray(options)) {
    options = [ { ...options, name: 'default' } ]
  } else if (options.length === 1) {
    options = options.reduce((o, option) => {
      return [ ...o, Object.assign(option, { name: 'default' }) ]
    }, [])
  }

  // assign default enquirer options
  options = options.reduce((o, option) => {
    return [
      ...o,
      Object.assign(option, {
        // this is for outside calls, if it is not called from taskwrapper with bind
        stdout: this instanceof TaskWrapper ? settings?.stdout ?? this.stdout() : process.stdout,
        onCancel: cancelCallback.bind(this, settings)
      })
    ]
  }, [])

  let enquirer: Enquirer
  if (settings?.enquirer) {
    // injected enquirer
    enquirer = settings.enquirer
  } else {
    try {
      enquirer = new (await import('enquirer')).default()
    } catch (e) /* istanbul ignore next */ {
      this.task.prompt = new PromptError('Enquirer is a peer dependency that must be installed seperately.')
      throw new Error(e)
    }
  }

  // i use this externally as well, this is a bandaid
  if (this instanceof TaskWrapper) {
    // Capture the prompt instance so we can use it later
    enquirer.on('prompt', (prompt: PromptInstance) => this.task.prompt = prompt)

    // Clear the prompt instance once it's submitted
    // Can't use on cancel, since that might hold a PromptError object
    enquirer.on('submit', () => this.task.prompt = undefined)

    this.task.subscribe((event) => {
      if (event.type === 'STATE' && event.data === stateConstants.SKIPPED) {
        if (this.task.prompt && !(this.task.prompt instanceof PromptError)) {
          this.task.prompt.submit()
        }
      }
    })
  }

  const response = (await enquirer.prompt(options as any)) as any

  // return default name if it is single prompt
  if (options.length === 1) {
    return response.default
  } else {
    return response
  }
}

export function destroyPrompt (this: TaskWrapper<any, any>, throwError = false): void {
  if (!this.task.prompt || this.task.prompt instanceof PromptError) {
    // If there's no prompt, can't cancel
    return
  }

  if (throwError) {
    this.task.prompt.cancel()
  } else {
    this.task.prompt.submit()
  }
}

function defaultCancelCallback (settings: PromptSettings): string | Error | PromptError | void {
  const errorMsg = 'Cancelled prompt.'

  if (this instanceof TaskWrapper) {
    this.task.prompt = new PromptError(errorMsg)
  } /* istanbul ignore next */ else if (settings?.error !== false) {
    throw new Error(errorMsg)
  } /* istanbul ignore next */ else {
    return errorMsg
  }
}
