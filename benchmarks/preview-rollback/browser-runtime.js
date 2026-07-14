(() => {
  let activePreview = null;
  const rolledBackPreviewIds = new Set();
  const markerPrefix = 'match-my-exp-preview:';

  const allOpenElements = () => {
    const elements = [];
    const visit = (root) => {
      for (const element of root.querySelectorAll('*')) {
        elements.push(element);
        if (element.shadowRoot !== null) {
          visit(element.shadowRoot);
        }
      }
    };
    visit(document);
    return elements;
  };

  const resolveTarget = (target) => {
    if (target?.kind !== 'ephemeral' || typeof target.elementId !== 'string') {
      throw new Error('invalid_target');
    }
    const matches = allOpenElements().filter(
      (element) => element.getAttribute('data-spike-id') === target.elementId,
    );
    if (matches.length !== 1) {
      throw new Error('target_resolution_failed');
    }
    const [element] = matches;
    if (!element.isConnected || element.ownerDocument !== document) {
      throw new Error('target_is_stale');
    }
    return element;
  };

  const attributeState = (element, name) => ({
    present: element.hasAttribute(name),
    value: element.getAttribute(name),
  });

  const propertyState = (element, property) => {
    let present = false;
    for (let index = 0; index < element.style.length; index += 1) {
      if (element.style.item(index) === property) {
        present = true;
      }
    }
    return {
      present,
      value: element.style.getPropertyValue(property),
      priority: element.style.getPropertyPriority(property),
    };
  };

  const sameAttributeState = (left, right) =>
    left.present === right.present && left.value === right.value;

  const samePropertyState = (left, right) =>
    left.present === right.present &&
    left.value === right.value &&
    left.priority === right.priority;

  const compileMove = (target, destination, placement) => {
    const root = target.getRootNode();
    if (
      root !== destination.getRootNode() ||
      !(root instanceof Document || root instanceof ShadowRoot)
    ) {
      throw new Error('cross_root_move');
    }
    if (target === destination) {
      throw new Error('move_target_is_destination');
    }

    let parent;
    let reference;
    if (placement === 'before' || placement === 'after') {
      parent = destination.parentNode;
      reference =
        placement === 'before' ? destination : destination.nextSibling;
    } else if (placement === 'inside-start' || placement === 'inside-end') {
      parent = destination;
      reference = placement === 'inside-start' ? destination.firstChild : null;
    } else {
      throw new Error('invalid_move_placement');
    }
    if (!(parent instanceof Element || parent instanceof ShadowRoot)) {
      throw new Error('invalid_move_parent');
    }
    if (typeof parent.moveBefore !== 'function') {
      throw new Error('move_before_unavailable');
    }
    if (target.contains(parent)) {
      throw new Error('move_cycle');
    }
    return { parent, reference, root };
  };

  const compile = (request) => {
    if (
      request === null ||
      typeof request !== 'object' ||
      typeof request.previewId !== 'string' ||
      request.previewId.length === 0 ||
      request.expectedOrigin !== location.origin ||
      request.expectedPath !== location.pathname ||
      !Array.isArray(request.operations) ||
      request.operations.length === 0
    ) {
      throw new Error('invalid_preview_request');
    }

    const operationIds = new Set();
    const writeCells = new Set();
    const movedTargets = new Set();
    const compiled = [];
    for (const operation of request.operations) {
      if (
        operation === null ||
        typeof operation !== 'object' ||
        typeof operation.operationId !== 'string' ||
        operationIds.has(operation.operationId)
      ) {
        throw new Error('invalid_operation_id');
      }
      operationIds.add(operation.operationId);
      const target = resolveTarget(operation.target);

      if (operation.kind === 'style') {
        if (
          !(target instanceof HTMLElement) ||
          !Array.isArray(operation.declarations)
        ) {
          throw new Error('invalid_style_operation');
        }
        const probe = document.createElement('div');
        for (const declaration of operation.declarations) {
          const cell = `${operation.target.elementId}:style:${declaration.property}`;
          if (writeCells.has(cell)) {
            throw new Error('duplicate_write_cell');
          }
          writeCells.add(cell);
          probe.style.removeProperty(declaration.property);
          probe.style.setProperty(declaration.property, declaration.value);
          if (probe.style.getPropertyValue(declaration.property) === '') {
            throw new Error('invalid_css_value');
          }
        }
        compiled.push({ ...operation, resolvedTarget: target });
        continue;
      }

      if (operation.kind === 'aria') {
        const cell = `${operation.target.elementId}:attribute:${operation.attribute}`;
        if (writeCells.has(cell)) {
          throw new Error('duplicate_write_cell');
        }
        writeCells.add(cell);
        compiled.push({ ...operation, resolvedTarget: target });
        continue;
      }

      if (operation.kind === 'move') {
        if (movedTargets.size > 0) {
          throw new Error('multiple_moves_unsupported');
        }
        movedTargets.add(target);
        const destination = resolveTarget(operation.destination);
        compiled.push({
          ...operation,
          resolvedTarget: target,
          resolvedDestination: destination,
          compiledMove: compileMove(target, destination, operation.placement),
        });
        continue;
      }

      throw new Error('unsupported_operation');
    }
    return compiled;
  };

  const restoreProperty = (entry, conflicts) => {
    if (entry.applied === null) {
      return;
    }
    const currentRaw = attributeState(entry.element, 'style');
    if (sameAttributeState(currentRaw, entry.appliedRaw)) {
      if (entry.beforeRaw.present) {
        entry.element.setAttribute('style', entry.beforeRaw.value ?? '');
      } else {
        entry.element.removeAttribute('style');
      }
      return;
    }
    const current = propertyState(entry.element, entry.property);
    if (!samePropertyState(current, entry.applied)) {
      conflicts.push(`${entry.operationId}:style`);
      return;
    }
    if (entry.before.present) {
      entry.element.style.setProperty(
        entry.property,
        entry.before.value,
        entry.before.priority,
      );
    } else {
      entry.element.style.removeProperty(entry.property);
    }
    if (!entry.beforeRaw.present && entry.element.style.length === 0) {
      entry.element.removeAttribute('style');
    }
  };

  const restoreAttribute = (entry, conflicts) => {
    if (entry.applied === null) {
      return;
    }
    const current = attributeState(entry.element, entry.attribute);
    if (!sameAttributeState(current, entry.applied)) {
      conflicts.push(`${entry.operationId}:attribute`);
      return;
    }
    if (entry.before.present) {
      entry.element.setAttribute(entry.attribute, entry.before.value ?? '');
    } else {
      entry.element.removeAttribute(entry.attribute);
    }
  };

  const removeMarker = (marker) => {
    if (marker.parentNode !== null) {
      marker.remove();
    }
  };

  const restoreMove = (entry, conflicts) => {
    if (entry.moved) {
      const owned =
        entry.target.parentNode === entry.appliedParent &&
        entry.target.previousSibling === entry.destinationStart &&
        entry.target.nextSibling === entry.destinationEnd &&
        entry.sourceMarker.parentNode === entry.originalParent;
      if (owned && typeof entry.originalParent.moveBefore === 'function') {
        entry.originalParent.moveBefore(entry.target, entry.sourceMarker);
      } else {
        conflicts.push(`${entry.operationId}:move`);
      }
    }
    removeMarker(entry.sourceMarker);
    removeMarker(entry.destinationStart);
    removeMarker(entry.destinationEnd);
  };

  const rollbackJournal = (journal) => {
    const conflicts = [];
    for (const entry of journal.toReversed()) {
      try {
        if (entry.kind === 'style') {
          restoreProperty(entry, conflicts);
        } else if (entry.kind === 'aria') {
          restoreAttribute(entry, conflicts);
        } else {
          restoreMove(entry, conflicts);
        }
      } catch {
        conflicts.push(`${entry.operationId}:rollback-error`);
      }
    }
    return conflicts;
  };

  const apply = (request, options = {}) => {
    const payload = JSON.stringify(request.operations);
    if (activePreview !== null) {
      if (
        activePreview.previewId === request.previewId &&
        activePreview.payload === payload
      ) {
        return { status: 'active', conflicts: [], mutations: 0 };
      }
      return {
        status: 'rejected',
        reason: 'preview_already_active',
        conflicts: [],
        mutations: 0,
      };
    }
    if (rolledBackPreviewIds.has(request.previewId)) {
      return {
        status: 'rejected',
        reason: 'preview_id_reused',
        conflicts: [],
        mutations: 0,
      };
    }

    let compiled;
    try {
      compiled = compile(request);
    } catch (error) {
      return {
        status: 'rejected',
        reason: error instanceof Error ? error.message : 'preflight_failed',
        conflicts: [],
        mutations: 0,
      };
    }

    const journal = [];
    let mutations = 0;
    const didMutate = () => {
      mutations += 1;
      if (options.failAfterMutation === mutations) {
        throw new Error('injected_interruption');
      }
    };

    try {
      if (
        request.expectedOrigin !== location.origin ||
        request.expectedPath !== location.pathname ||
        compiled.some(
          ({ resolvedTarget }) =>
            !resolvedTarget.isConnected ||
            resolvedTarget.ownerDocument !== document,
        )
      ) {
        throw new Error('identity_changed_before_commit');
      }

      for (const operation of compiled) {
        if (operation.kind === 'style') {
          for (const declaration of operation.declarations) {
            const entry = {
              kind: 'style',
              operationId: operation.operationId,
              element: operation.resolvedTarget,
              property: declaration.property,
              beforeRaw: attributeState(operation.resolvedTarget, 'style'),
              before: propertyState(
                operation.resolvedTarget,
                declaration.property,
              ),
              applied: null,
              appliedRaw: null,
            };
            journal.push(entry);
            operation.resolvedTarget.style.setProperty(
              declaration.property,
              declaration.value,
            );
            entry.applied = propertyState(
              operation.resolvedTarget,
              declaration.property,
            );
            entry.appliedRaw = attributeState(
              operation.resolvedTarget,
              'style',
            );
            didMutate();
          }
          continue;
        }

        if (operation.kind === 'aria') {
          const entry = {
            kind: 'aria',
            operationId: operation.operationId,
            element: operation.resolvedTarget,
            attribute: operation.attribute,
            before: attributeState(
              operation.resolvedTarget,
              operation.attribute,
            ),
            applied: null,
          };
          journal.push(entry);
          if (operation.value === null) {
            operation.resolvedTarget.removeAttribute(operation.attribute);
          } else {
            operation.resolvedTarget.setAttribute(
              operation.attribute,
              operation.value,
            );
          }
          entry.applied = attributeState(
            operation.resolvedTarget,
            operation.attribute,
          );
          didMutate();
          continue;
        }

        const sourceMarker = new Comment(
          `${markerPrefix}${request.previewId}:source`,
        );
        const destinationStart = new Comment(
          `${markerPrefix}${request.previewId}:start`,
        );
        const destinationEnd = new Comment(
          `${markerPrefix}${request.previewId}:end`,
        );
        const entry = {
          kind: 'move',
          operationId: operation.operationId,
          target: operation.resolvedTarget,
          originalParent: operation.resolvedTarget.parentNode,
          appliedParent: operation.compiledMove.parent,
          sourceMarker,
          destinationStart,
          destinationEnd,
          moved: false,
        };
        if (
          !(entry.originalParent instanceof Element) &&
          !(entry.originalParent instanceof ShadowRoot)
        ) {
          throw new Error('source_parent_changed');
        }
        journal.push(entry);
        entry.originalParent.insertBefore(sourceMarker, entry.target);
        didMutate();
        operation.compiledMove.parent.insertBefore(
          destinationStart,
          operation.compiledMove.reference,
        );
        didMutate();
        operation.compiledMove.parent.insertBefore(
          destinationEnd,
          operation.compiledMove.reference,
        );
        didMutate();
        operation.compiledMove.parent.moveBefore(entry.target, destinationEnd);
        entry.moved = true;
        didMutate();
      }

      activePreview = {
        previewId: request.previewId,
        payload,
        journal,
        mutations,
      };
      return { status: 'active', conflicts: [], mutations };
    } catch (error) {
      const conflicts = rollbackJournal(journal);
      return {
        status: 'rejected',
        reason: error instanceof Error ? error.message : 'apply_failed',
        conflicts,
        mutations,
      };
    }
  };

  const rollbackActive = () => {
    if (activePreview === null) {
      return {
        status: 'rolled-back',
        conflicts: [],
        mutations: 0,
      };
    }
    const preview = activePreview;
    activePreview = null;
    const conflicts = rollbackJournal(preview.journal);
    rolledBackPreviewIds.add(preview.previewId);
    return {
      status: 'rolled-back',
      conflicts,
      mutations: preview.mutations,
    };
  };

  const rollback = (previewId) => {
    if (activePreview === null) {
      if (rolledBackPreviewIds.has(previewId)) {
        return { status: 'rolled-back', conflicts: [], mutations: 0 };
      }
      return {
        status: 'rejected',
        reason: 'preview_not_active',
        conflicts: [],
        mutations: 0,
      };
    }
    if (activePreview.previewId !== previewId) {
      return {
        status: 'rejected',
        reason: 'stale_preview_id',
        conflicts: [],
        mutations: 0,
      };
    }
    return rollbackActive();
  };

  const markerCount = () => {
    let count = 0;
    const visit = (root) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
      while (walker.nextNode()) {
        if (walker.currentNode.data.startsWith(markerPrefix)) {
          count += 1;
        }
      }
      for (const element of root.querySelectorAll('*')) {
        if (element.shadowRoot !== null) {
          visit(element.shadowRoot);
        }
      }
    };
    visit(document);
    return count;
  };

  const status = () => ({
    activePreviewId: activePreview?.previewId ?? null,
    markerCount: markerCount(),
  });

  if (globalThis.navigation !== undefined) {
    globalThis.navigation.addEventListener('navigate', rollbackActive);
  }
  globalThis.addEventListener('pagehide', rollbackActive);

  globalThis.previewRollbackSpike = Object.freeze({
    apply,
    rollback,
    status,
  });
})();
