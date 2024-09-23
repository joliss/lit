/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {type ReactiveElement} from '@lit/reactive-element';

// #region Types

export interface FormValueOptions<T> {
  converter?: FormValueConverter<T>;
}

interface FormValueConverter<T> {
  toFormValue(v: T): FormValue;
  fromFormValue(v: FormValue): T;
}

export type FormValue = string | File | FormData | null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Constructor<T = object> = new (...args: any[]) => T;

export interface FormAssociated extends ReactiveElement {
  /**
   * Implement this method to validate the element. Return a `ValidityResult`.
   */
  _getValidity?(): ValidityResult;

  /**
   * Internal method to validate the element. This method should be called by
   * the element when it's state might have changed in a way that would affect
   * its validity.
   *
   * Calls `_getValidity` and sets the validity flags on the element's
   * internals, then returns the result of `internals.checkValidity()`.
   *
   * It's often a good idea to call this method in the constructor to set the
   * initial validity state.
   */
  _validate(): boolean;
}
type FormAssociatedInterface = FormAssociated;

export interface FormAssociatedConstructor {
  role?: ElementInternals['role'];

  formAssociated: true;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  new (...args: any[]): FormAssociated;
}

interface ValidityResult {
  flags: Partial<Omit<ValidityState, 'valid'>>;
  message?: string;
  anchor?: HTMLElement;
}

type Access<T = unknown> = ClassAccessorDecoratorContext<
  FormAssociated,
  T
>['access'];

// #endregion

// #region Shared State

const internalsCache = new WeakMap<
  FormAssociated,
  {internals: ElementInternals; classes: WeakSet<Function>}
>();

const valueAccessors = new WeakMap<DecoratorMetadataObject, Access>();

const stateAccessors = new WeakMap<
  DecoratorMetadataObject,
  Access<FormValue>
>();

/*
 * A store of initial values for FormAssociated elements so that they can be
 * restored when the form is reset.
 */
const initialValues = new WeakMap<FormAssociated, unknown>();

/*
 * A store of initial values for FormAssociated elements so that they can be
 * restored when the form is reset.
 */
const initialStates = new WeakMap<FormAssociated, FormValue>();

const formValueOptions = new WeakMap<
  DecoratorMetadataObject,
  FormValueOptions<unknown>
>();

// #endregion

// #region Utilities

/**
 * Returns the ElementInternals for a FormAssociated element. This should only
 * be called by subclasses of FormAssociated.
 */
export const getInternals = (
  c: FormAssociatedConstructor,
  element: FormAssociated
) => {
  // TODO (justinfagnani): outlaw any constructor below the FormAssociated
  // mixin, like LitElement, ReactiveElement, etc.
  if (!(element instanceof c)) {
    throw new Error('Element is not an instance of the constructor');
  }
  const state = internalsCache.get(element);
  if (state === undefined) {
    throw new Error('ElementInternals not found');
  }
  if (state.classes.has(c)) {
    throw new Error('getInternals called twice with the same constructor');
  }
  state.classes.add(c);
  return state.internals;
};

/*
 * Private function to get the internals for a FormAssociated element. For use
 * in decorators.
 */
const _getInternals = (element: FormAssociated) => {
  return internalsCache.get(element)!.internals;
};

/**
 * Returns true if the element is disabled.
 */
export const isDisabled = (element: FormAssociated) =>
  element.matches(':disabled');

// #endregion

// #region FormAssociated

/**
 * A mixin that makes a ReactiveElement into a form-associated custom element.
 *
 * - ARIA role: Sets this element's ElementInternals role to the value of the
 *   static `role` property.
 * - Form value: The value of the element is stored in the field decorated with
 *   the `@formValue()` decorator. This value field can have any name, but the
 *   type must be assignable to `string | File | FormData | null`.
 * - Form state: The state of the element is stored in the field decorated with
 *   the `@formState()` decorator. This state field can have any name, but the
 *   type must be assignable to `string | File | FormData | null`. The state
 *   field should be private, as it is only intended to be set by the
 *   FormAssociated mixin. The state field should usually be a getter/setter
 *   pair so that the form value can be derived from the state during form
 *   state restoration.
 * - Form reset: When the form is reset, the value field is set to its initial
 *   value, and the state field is set to its initial state. This means that the
 *   initial value and state will be stored for the lifetime of the element.
 * - Form state restoration: When the form is restored, the mode can be either
 *   'restore' or 'autocomplete'. In 'restore' mode, the state field is set to
 *   the state setter, if present, is set to the state that was previously
 *   passed to `internals.setFormValue()`. It's the state setter's
 *   responsibility to update the value setter. If there is no state setter, the
 *   value setter is updated directly. In 'autocomplete' mode, the value setter
 *   is updated directly.
 * - Form disabled: When the element is disabled, the `ariaDisabled` property of
 *   the ElementInternals is set to "true". The element's disable state can be
 *   checked with the `isDisabled()` function (an alias for
 *   `element.matches(':disabled')`).
 * - Validation: An element can implement the  `_getValidity()` method to
 *   validate its state. This method is called automatically when the form value
 *   changes, and can be called manually by the element.
 */
export const FormAssociated = <T extends Constructor<ReactiveElement>>(
  base: T
) => {
  class C extends base implements FormAssociatedInterface {
    static formAssociated = true;

    #internals: ElementInternals;

    _getValidity?(): ValidityResult;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(...args: any[]) {
      super(...args);
      const internals = this.attachInternals();
      this.#internals = internals;
      internalsCache.set(this, {internals, classes: new WeakSet()});
      internals.role =
        (this.constructor as FormAssociatedConstructor).role ?? null;
    }

    _validate() {
      if (this._getValidity !== undefined) {
        const {flags, message, anchor} = this._getValidity();
        this.#internals.setValidity(flags, message, anchor);
      }
      return this.#internals.checkValidity();
    }

    formDisabledCallback(disabled: boolean) {
      this.#internals.ariaDisabled = String(disabled);
      this.requestUpdate();
    }

    formResetCallback() {
      const metadata = this.constructor[Symbol.metadata]!;

      // Restore the initial value
      const valueAccess = valueAccessors.get(metadata);
      const initialValue = initialValues.get(this);
      valueAccess?.set(this, initialValue);

      // Restore the initial state
      const stateAccess = stateAccessors.get(metadata);
      const initialState = initialStates.get(this);
      if (initialState !== undefined) {
        stateAccess?.set(this, initialState);
      }
    }

    formStateRestoreCallback(
      state: string | File | FormData | null,
      mode: 'restore' | 'autocomplete'
    ) {
      const metadata = this.constructor[Symbol.metadata]!;
      if (mode === 'restore') {
        // When restoring a value we should get the state previously passed to
        // internals.setFormValue(). We can pass that to the state accessor,
        // which should update the value accessor.
        // If there is no state accessor, we should update the value accessor
        const stateAccess = stateAccessors.get(metadata);
        if (stateAccess !== undefined) {
          stateAccess.set(this, state);
        } else {
          const valueAccess = valueAccessors.get(metadata);
          const valueOptions = formValueOptions.get(metadata);
          if (valueOptions?.converter !== undefined) {
            const value = valueOptions.converter.fromFormValue(state);
            valueAccess?.set(this, value);
          } else {
            valueAccess?.set(this, state);
          }
        }
      } else if (mode === 'autocomplete') {
        // When autocompleting a value, we don't get a previous state object, so
        // we should update the value accessor directly.
        const valueAccess = valueAccessors.get(metadata);
        const valueOptions = formValueOptions.get(metadata);
        if (valueOptions?.converter !== undefined) {
          const value = valueOptions.converter.fromFormValue(state);
          valueAccess?.set(this, value);
        } else {
          valueAccess?.set(this, state);
        }
      }
    }
  }
  return C as Constructor<FormAssociated> & T & FormAssociatedConstructor;
};

// #endregion

// #region Decorators

const updateFormValue = (
  el: FormAssociated,
  metadata: DecoratorMetadataObject,
  value: unknown
) => {
  const options = formValueOptions.get(metadata);
  const internals = _getInternals(el);
  const stateAccess = stateAccessors.get(metadata);
  const state = stateAccess?.get(el);
  internals.setFormValue(
    options?.converter === undefined
      ? (value as FormValue)
      : options.converter.toFormValue(value),
    state
  );
  el._validate();
};

/**
 * A class accessor decorator that marks a field as the form value for the
 * FormAssociated mixin.
 */
export const formValue =
  <T = FormValue>(options?: FormValueOptions<T>) =>
  <C extends FormAssociated, V extends T>(
    target: ClassAccessorDecoratorTarget<C, V>,
    context: ClassAccessorDecoratorContext<C, V>
  ): ClassAccessorDecoratorResult<C, V> => {
    valueAccessors.set(context.metadata, context.access);
    if (options !== undefined) {
      formValueOptions.set(context.metadata, options);
    }

    return {
      get: target.get,
      set(value: V) {
        target.set.call(this, value);
        updateFormValue(this, context.metadata, value);
      },
      init(value: V) {
        initialValues.set(this, value);
        return value;
      },
    };
  };

type FormStateDecorator = {
  // Accessor decorator signature
  <C extends FormAssociated, V>(
    target: ClassAccessorDecoratorTarget<C, V>,
    context: ClassAccessorDecoratorContext<C, V>
  ): ClassAccessorDecoratorResult<C, V>;

  // Setter decorator signature
  <C extends FormAssociated, V>(
    target: (this: C, v: V) => void,
    context: ClassSetterDecoratorContext<C, V>
  ): (this: C, v: V) => void;
};

/**
 * A class accessor or setter decorator that marks a field as being part of the
 * form state for the FormAssociated mixin. When this value is set, the form
 * value is updated with the new state.
 */
export const formState = (): FormStateDecorator =>
  (<C extends FormAssociated, V>(
    target: ClassAccessorDecoratorTarget<C, V> | ((this: C, v: V) => void),
    context:
      | ClassAccessorDecoratorContext<C, V>
      | ClassSetterDecoratorContext<C, V>
  ): ClassAccessorDecoratorResult<C, V> | ((this: C, v: V) => void) => {
    if (context.kind === 'accessor') {
      return {
        get: (target as ClassAccessorDecoratorTarget<C, V>).get,
        set(value: V) {
          (target as ClassAccessorDecoratorTarget<C, V>).set.call(this, value);
          updateFormValue(this, context.metadata, value);
        },
      };
    } else {
      return function (this: C, value: V) {
        (target as (this: C, v: V) => void).call(this, value);
        updateFormValue(this, context.metadata, value);
      };
    }
  }) as FormStateDecorator;

/**
 * A class getter decorator that marks a getter as the form state for the
 * FormAssociated mixin.
 *
 * This getter should usually be private. The getter should only be called by
 * the FormAssociated mixin, not by the element itself.
 */
export const formStateGetter =
  () =>
  <C extends FormAssociated, V extends FormValue>(
    target: (this: C) => V,
    context: ClassGetterDecoratorContext<C, V>
  ): ((this: C) => V) => {
    const access = stateAccessors.get(context.metadata) ?? {};
    Object.assign(
      access,
      (context as ClassGetterDecoratorContext<C, V>).access
    );
    stateAccessors.set(context.metadata, access as Access<FormValue>);
    return target;
  };

/**
 * A class setter decorator that marks a setter as the form state for the
 * FormAssociated mixin.
 *
 * This setter should usually be private. The setter should only be called by
 * the FormAssociated mixin, not by the element itself.
 */
export const formStateSetter =
  () =>
  <C extends FormAssociated, V extends FormValue>(
    target: (this: C, v: V) => void,
    context: ClassSetterDecoratorContext<C, V>
  ): ((this: C, v: V) => void) => {
    const access = stateAccessors.get(context.metadata) ?? {};
    Object.assign(
      access,
      (context as ClassSetterDecoratorContext<C, V>).access
    );
    stateAccessors.set(context.metadata, access as Access<FormValue>);
    return target;
  };

// #endregion
