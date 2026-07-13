(() => {
  const excludedTags = new Set([
    'script',
    'style',
    'template',
    'noscript',
    'svg',
    'path',
  ]);
  const sampledStyleProperties = [
    'align-items',
    'background-color',
    'color',
    'display',
    'flex-direction',
    'font-family',
    'font-size',
    'font-weight',
    'gap',
    'height',
    'justify-content',
    'line-height',
    'opacity',
    'position',
    'visibility',
    'width',
  ];
  const capturedAttributes = [
    'aria-describedby',
    'aria-label',
    'aria-labelledby',
    'class',
    'data-testid',
    'id',
    'name',
    'role',
    'type',
  ];

  const normalizeText = (value) => (value ?? '').replace(/\s+/g, ' ').trim();

  const isFormValueElement = (element) =>
    element instanceof HTMLInputElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement;

  const isVisible = (element) => {
    let current = element;
    while (current !== null) {
      if (current.hasAttribute('hidden')) {
        return false;
      }
      if (current.getAttribute('aria-hidden') === 'true') {
        return false;
      }
      const style = getComputedStyle(current);
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.opacity === '0'
      ) {
        return false;
      }
      if (current.parentElement !== null) {
        current = current.parentElement;
        continue;
      }
      const root = current.getRootNode();
      current = root instanceof ShadowRoot ? root.host : null;
    }
    return true;
  };

  const ownText = (element) => {
    if (isFormValueElement(element)) {
      return '';
    }
    return normalizeText(
      Array.from(element.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent)
        .join(' '),
    );
  };

  const visibleText = (element) => {
    if (isFormValueElement(element)) {
      return '';
    }
    const parts = [ownText(element)];
    for (const child of element.children) {
      if (!excludedTags.has(child.tagName.toLowerCase()) && isVisible(child)) {
        parts.push(visibleText(child));
      }
    }
    if (element.shadowRoot !== null) {
      for (const child of element.shadowRoot.children) {
        if (
          !excludedTags.has(child.tagName.toLowerCase()) &&
          isVisible(child)
        ) {
          parts.push(visibleText(child));
        }
      }
    }
    return normalizeText(parts.join(' '));
  };

  const findLabelledElement = (element, id) => {
    const root = element.getRootNode();
    if (root instanceof Document || root instanceof ShadowRoot) {
      return root.querySelector(`#${CSS.escape(id)}`);
    }
    return null;
  };

  const accessibleName = (element) => {
    const ariaLabel = normalizeText(element.getAttribute('aria-label'));
    if (ariaLabel.length > 0) {
      return ariaLabel;
    }
    const labelledBy = normalizeText(element.getAttribute('aria-labelledby'));
    if (labelledBy.length > 0) {
      const label = labelledBy
        .split(' ')
        .map((id) => findLabelledElement(element, id))
        .filter(
          (labelledElement) =>
            labelledElement !== null &&
            !excludedTags.has(labelledElement.tagName.toLowerCase()) &&
            isVisible(labelledElement),
        )
        .map((labelledElement) => visibleText(labelledElement))
        .filter(Boolean)
        .join(' ');
      if (label.length > 0) {
        return label;
      }
    }
    if (isFormValueElement(element)) {
      const labelElement = element.labels?.[0];
      if (labelElement !== undefined && isVisible(labelElement)) {
        const label = visibleText(labelElement);
        if (label.length > 0) {
          return label;
        }
      }
      const placeholder = normalizeText(element.getAttribute('placeholder'));
      if (placeholder.length > 0) {
        return placeholder;
      }
    }
    return visibleText(element).slice(0, 256);
  };

  const implicitRole = (element, name) => {
    const explicitRole = normalizeText(element.getAttribute('role'));
    if (explicitRole.length > 0) {
      return explicitRole;
    }
    const roles = {
      article: 'article',
      aside: 'complementary',
      button: 'button',
      footer: 'contentinfo',
      header: 'banner',
      main: 'main',
      nav: 'navigation',
      select: 'combobox',
      textarea: 'textbox',
      ul: 'list',
      ol: 'list',
      li: 'listitem',
    };
    if (/^h[1-6]$/.test(element.tagName.toLowerCase())) {
      return 'heading';
    }
    if (element instanceof HTMLAnchorElement && element.hasAttribute('href')) {
      return 'link';
    }
    if (element instanceof HTMLInputElement) {
      return element.type === 'search' ? 'searchbox' : 'textbox';
    }
    if (element.tagName.toLowerCase() === 'section' && name.length > 0) {
      return 'region';
    }
    return roles[element.tagName.toLowerCase()];
  };

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

  const capture = (idSeed) => {
    const elements = [];
    const oracle = {};
    let nextElementId = 0;

    const walk = (element, parentId, shadowHostId) => {
      const tag = element.tagName.toLowerCase();
      if (excludedTags.has(tag) || !isVisible(element)) {
        return;
      }

      const elementId = `element-${idSeed}-${nextElementId.toString(36)}`;
      nextElementId += 1;
      element.setAttribute('data-benchmark-ephemeral-id', elementId);
      const benchmarkKey = element.getAttribute('data-benchmark-key');
      if (benchmarkKey !== null) {
        if (oracle[benchmarkKey] !== undefined) {
          throw new Error(`Duplicate benchmark key ${benchmarkKey}`);
        }
        oracle[benchmarkKey] = elementId;
      }

      const name = accessibleName(element);
      const text = ownText(element).slice(0, 512);
      const role = implicitRole(element, name);
      const bounds = element.getBoundingClientRect();
      const computedStyle = getComputedStyle(element);
      const record = {
        elementId,
        tag,
        attributes: capturedAttributes.flatMap((attribute) => {
          const value = element.getAttribute(attribute);
          return value === null
            ? []
            : [{ name: attribute, value: value.slice(0, 256) }];
        }),
        computedStyles: sampledStyleProperties.map((property) => ({
          property,
          value: computedStyle.getPropertyValue(property).slice(0, 256),
        })),
        bounds: {
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
        },
      };
      if (parentId !== undefined) {
        record.parentId = parentId;
      }
      if (shadowHostId !== undefined) {
        record.shadowHostId = shadowHostId;
      }
      if (role !== undefined) {
        record.role = role;
      }
      if (name.length > 0) {
        record.accessibleName = name;
      }
      if (text.length > 0) {
        record.text = text;
      }
      elements.push(record);

      for (const child of element.children) {
        walk(child, elementId, shadowHostId);
      }
      if (element.shadowRoot !== null) {
        for (const child of element.shadowRoot.children) {
          walk(child, elementId, elementId);
        }
      }
    };

    walk(document.documentElement);
    const context = {
      schemaVersion: 1,
      origin: location.origin,
      path: location.pathname,
      title: document.title.slice(0, 256),
      elements,
    };
    return {
      context,
      oracle,
      serializedBytes: new TextEncoder().encode(JSON.stringify(context)).length,
    };
  };

  const clearProbes = () => {
    for (const element of allOpenElements()) {
      element.removeAttribute('data-benchmark-probed');
    }
  };

  const probe = (elementIds) => {
    const elements = allOpenElements();
    const targets = elementIds.map((id) =>
      elements.filter(
        (element) => element.getAttribute('data-benchmark-ephemeral-id') === id,
      ),
    );
    if (targets.some((matches) => matches.length !== 1)) {
      return 0;
    }
    for (const [target] of targets) {
      target.setAttribute('data-benchmark-probed', 'true');
    }
    return targets.length;
  };

  const countProbes = () =>
    allOpenElements().filter(
      (element) => element.getAttribute('data-benchmark-probed') === 'true',
    ).length;

  globalThis.targetingBenchmark = Object.freeze({
    capture,
    clearProbes,
    probe,
    countProbes,
  });
})();
