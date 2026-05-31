figma.showUI(__html__, { width: 380, height: 460 });
let multiSelectMode = false;
const multiSelectIds = new Set();

function getSection(node) {
  let current = node.parent;
  while (current) {
    if (current.type === "SECTION") return current;
    if (current.type === "PAGE") return null;
    current = current.parent;
  }
  return null;
}

function getPageName(node) {
  let current = node;
  while (current) {
    if (current.type === "PAGE") return current.name;
    current = current.parent;
  }
  return figma.currentPage.name;
}

function getRenameTargets() {
  if (!multiSelectMode) return figma.currentPage.selection;
  const nodes = [];
  for (const id of multiSelectIds) {
    const node = figma.getNodeById(id);
    if (node && "name" in node && "parent" in node) nodes.push(node);
  }
  return nodes;
}

var VARIANTS = ["Home", "Away", "Shared", "Blue", "White"];

function buildSelectionInfo() {
  const selection = getRenameTargets();
  const pageName = selection.length > 0 ? getPageName(selection[0]) : figma.currentPage.name;
  const sections = new Set();
  let missingSection = false;
  let syncContext = null;
  let frameSuffix = null;

  for (const node of selection) {
    const section = getSection(node);
    if (section) sections.add(section.name);
    else missingSection = true;

    // Derive sync context from the first selected frame that matches the structure
    if (!syncContext) {
      const parts = node.name.split("/");
      if (parts.length >= 5 && parts[1] === "Uniform" && VARIANTS.indexOf(parts[3]) !== -1) {
        syncContext  = parts.slice(0, 4).join("/") + "/";
        frameSuffix  = parts[parts.length - 1]; // the hash/filename segment
      }
    }
  }

  return {
    type: "selection-info",
    count: selection.length,
    pageName,
    sections: Array.from(sections),
    missingSection,
    syncContext,
    frameSuffix,
    multiSelectMode
  };
}

figma.ui.postMessage(buildSelectionInfo());

figma.on("selectionchange", () => {
  figma.ui.postMessage(buildSelectionInfo());
});

figma.ui.onmessage = (msg) => {
  if (msg.type === "rename-basic") {
    const prefix    = msg.prefix.trim();
    const selection = figma.currentPage.selection;
    const pageName  = figma.currentPage.name;
    const usesName  = /\{name\}/i.test(prefix);

    if (!prefix) {
      figma.ui.postMessage({ type: "error", message: "Please enter a prefix." });
      return;
    }
    if (selection.length === 0) {
      figma.ui.postMessage({ type: "error", message: "No layers selected." });
      return;
    }

    for (const node of selection) {
      const section  = getSection(node);
      const resolved = prefix
        .replace(/\{page\}/gi,    pageName)
        .replace(/\{section\}/gi, section ? section.name : "")
        .replace(/\{name\}/gi,    node.name);

      // If {name} was used, the resolved string IS the full new name.
      // Otherwise append the original name after the prefix.
      node.name = usesName ? resolved : `${resolved}/${node.name}`;
    }

    figma.ui.postMessage({
      type:    "success",
      message: `Renamed ${selection.length} layer${selection.length > 1 ? "s" : ""}.`
    });
  }

  if (msg.type === "rename-advanced") {
    const variant = msg.variant;
    const selection = getRenameTargets();

    if (selection.length === 0) {
      figma.ui.postMessage({ type: "error", message: "No layers selected." });
      return;
    }

    const errors = [];
    let renamedCount = 0;

    const alreadyPrefixedUniform = /^[^/]+\/Uniform\/[^/]+\/(Home|Away|Shared|Blue|White)\/.+/;
    const alreadyPrefixedStadium = /^[^/]+\/Stadium\/Thumbnail\/.+/;
    let updated = 0;

    for (const node of selection) {
      const section = getSection(node);
      if (!section) {
        errors.push(`"${node.name}" is not inside a section.`);
        continue;
      }
      if (variant === "Stadium") {
        if (alreadyPrefixedStadium.test(node.name)) {
          const parts = node.name.split("/");
          parts[0] = section.name;
          node.name = parts.join("/");
          updated++;
        } else {
          node.name = `${section.name}/Stadium/Thumbnail/${node.name}`;
          renamedCount++;
        }
      } else if (alreadyPrefixedUniform.test(node.name)) {
        // Swap the variant segment (index 3) only
        const parts = node.name.split("/");
        parts[3] = variant;
        node.name = parts.join("/");
        updated++;
      } else {
        const pageName = getPageName(node);
        node.name = `${pageName}/Uniform/${section.name}/${variant}/${node.name}`;
        renamedCount++;
      }
    }

    if (errors.length > 0) {
      figma.ui.postMessage({ type: "error", message: errors[0] });
    } else {
      const parts = [];
      if (renamedCount > 0) parts.push(`Renamed ${renamedCount}`);
      if (updated > 0)      parts.push(`Updated ${updated}`);
      figma.ui.postMessage({
        type: "success",
        message: parts.join(", ") + ` layer${(renamedCount + updated) !== 1 ? "s" : ""}.`
      });
    }
  }

  if (msg.type === "change-variant") {
    const selection = figma.currentPage.selection;

    if (selection.length === 0) {
      figma.ui.postMessage({ type: "error", message: "No layers selected." });
      return;
    }

    let changed = 0;
    for (const node of selection) {
      const updated = node.name.replace(/\b(Home|Away|Shared|Blue|White)\b/g, msg.to);
      if (updated !== node.name) {
        node.name = updated;
        changed++;
      }
    }

    figma.ui.postMessage({
      type: "success",
      message: changed > 0
        ? `Updated ${changed} layer${changed !== 1 ? "s" : ""}.`
        : "No Home/Away/Shared found in selected names."
    });
  }

  if (msg.type === "check-sections") {
    const selection = figma.currentPage.selection;
    const mismatched = selection.filter(node => {
      const section = getSection(node);
      if (!section) return false;
      const parts = node.name.split("/");
      return parts.length >= 5 && parts[2] !== section.name;
    });
    figma.currentPage.selection = mismatched;
    figma.ui.postMessage({
      type: "check-sections-result",
      mismatches: mismatched.length,
      total: selection.length
    });
  }

  if (msg.type === "fix-sections") {
    const selection = figma.currentPage.selection;
    let fixed = 0;
    for (const node of selection) {
      const section = getSection(node);
      if (!section) continue;
      const parts = node.name.split("/");
      if (parts.length >= 5 && parts[2] !== section.name) {
        parts[2] = section.name;
        node.name = parts.join("/");
        fixed++;
      }
    }
    figma.ui.postMessage({
      type: "success",
      message: `Fixed ${fixed} frame${fixed !== 1 ? "s" : ""}.`
    });
  }

  if (msg.type === "fix-double-names") {
    var variants = ["Home", "Away", "Shared", "Blue", "White"];

    function fixDoubleName(name) {
      var parts = name.split("/");
      var lastStart = -1;
      for (var i = 0; i + 3 < parts.length; i++) {
        if (parts[i + 1] === "Uniform" && variants.indexOf(parts[i + 3]) !== -1) {
          lastStart = i;
        }
      }
      if (lastStart > 0) {
        return parts.slice(lastStart).join("/");
      }
      return name;
    }

    var allFrames = figma.currentPage.findAll(function(n) { return n.type === "FRAME"; });
    var fixed = 0;
    var fixedNodes = [];

    for (var i = 0; i < allFrames.length; i++) {
      var node = allFrames[i];
      var corrected = fixDoubleName(node.name);
      if (corrected !== node.name) {
        node.name = corrected;
        fixed++;
        fixedNodes.push(node);
      }
    }

    figma.currentPage.selection = fixedNodes;
    figma.ui.postMessage({
      type: "fix-double-result",
      fixed: fixed
    });
  }

  if (msg.type === "select-children") {
    const frames = figma.currentPage.selection;
    if (frames.length === 0) {
      figma.ui.postMessage({ type: "success-select", message: "No frames selected." });
      return;
    }
    const children = [];
    for (var i = 0; i < frames.length; i++) {
      if ("findAll" in frames[i]) {
        frames[i].findAll(function() { return true; }).forEach(function(n) {
          children.push(n);
        });
      }
    }
    figma.currentPage.selection = children;
    figma.ui.postMessage({
      type:    "success-select",
      message: `Selected ${children.length} element${children.length !== 1 ? "s" : ""} across ${frames.length} frame${frames.length !== 1 ? "s" : ""}.`
    });
  }

  if (msg.type === "select-jersey-frames") {
    const matched = figma.currentPage.findAll(function(n) {
      if (n.type !== "FRAME") return false;
      return n.findOne(function(child) {
        return child.name === "Inner Pads" || child.name === "Jersey Sleeve";
      }) !== null;
    });
    figma.currentPage.selection = matched;
    figma.ui.postMessage({
      type:    "success-select",
      message: matched.length > 0
        ? `Selected ${matched.length} jersey frame${matched.length !== 1 ? "s" : ""}.`
        : "No jersey frames found."
    });
  }

  if (msg.type === "select-all-frames") {
    const frames = [];
    for (const node of figma.currentPage.children) {
      if (node.type === "FRAME") {
        frames.push(node);
      } else if (node.type === "SECTION") {
        for (const child of node.children) {
          if (child.type === "FRAME") frames.push(child);
        }
      }
    }
    figma.currentPage.selection = frames;
    figma.ui.postMessage({
      type: "success-select",
      message: `Selected ${frames.length} frame${frames.length !== 1 ? "s" : ""}.`
    });
  }

  if (msg.type === "find-name-errors") {
    const pageName = figma.currentPage.name;
    const escaped = pageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const uniformPattern = new RegExp(
      `^${escaped}/Uniform/[^/]+/(Home|Away|Shared|Blue|White)/.+$`
    );

    const frames = [];
    for (const node of figma.currentPage.children) {
      if (node.type === "FRAME") {
        frames.push(node);
      } else if (node.type === "SECTION") {
        for (const child of node.children) {
          if (child.type === "FRAME") frames.push(child);
        }
      }
    }

    const misnamed = frames.filter(f => {
      const section = getSection(f);
      const stadiumPattern = section
        ? new RegExp(`^${section.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/Stadium/Thumbnail/.+$`)
        : null;
      return !uniformPattern.test(f.name) && !(stadiumPattern && stadiumPattern.test(f.name));
    });
    figma.currentPage.selection = misnamed;

    figma.ui.postMessage({
      type: "name-errors-result",
      total: frames.length,
      errorCount: misnamed.length
    });
  }

  if (msg.type === "apply-image") {
    const selection = figma.currentPage.selection;
    if (selection.length === 0) {
      figma.ui.postMessage({ type: "sync-error", message: "No frames selected." });
      return;
    }

    const image = figma.createImage(new Uint8Array(msg.bytes));
    let count = 0;

    function applyToImageFills(node) {
      if (!("fills" in node)) return;
      const existing = node.fills;
      if (existing.some(function(f) { return f.type === "IMAGE"; })) {
        node.fills = existing.map(function(f) {
          return f.type === "IMAGE" ? Object.assign({}, f, { imageHash: image.hash }) : f;
        });
        count++;
      }
    }

    for (const frame of selection) {
      // Apply to all image-fill nodes inside the frame (children, grandchildren, etc.)
      if ("findAll" in frame) {
        const imageNodes = frame.findAll(function(n) {
          return "fills" in n && n.fills.some(function(f) { return f.type === "IMAGE"; });
        });
        imageNodes.forEach(applyToImageFills);
      }
      // Also apply to the frame itself if it has an image fill
      applyToImageFills(frame);
    }

    figma.ui.postMessage({ type: "sync-applied", count });
  }

  if (msg.type === "export-png") {
    var exportSel = figma.currentPage.selection;
    if (exportSel.length === 0) {
      figma.ui.postMessage({ type: "shoot-error", message: "No layer selected." });
      return;
    }
    var exportNode = exportSel[0];
    exportNode.exportAsync({ format: "PNG" }).then(function(bytes) {
      figma.ui.postMessage({ type: "png-exported", bytes: bytes, name: exportNode.name });
    }).catch(function() {
      figma.ui.postMessage({ type: "shoot-error", message: "Export failed." });
    });
  }

  if (msg.type === "close") {
    figma.closePlugin();
  }

  if (msg.type === "toggle-multi-select") {
    multiSelectMode = !!msg.enabled;
    if (!multiSelectMode) multiSelectIds.clear();
    figma.ui.postMessage(buildSelectionInfo());
  }

  if (msg.type === "multi-add-current-selection") {
    for (const node of figma.currentPage.selection) {
      if ("id" in node) multiSelectIds.add(node.id);
    }
    figma.ui.postMessage(buildSelectionInfo());
    figma.ui.postMessage({
      type: "success",
      message: `Added ${figma.currentPage.selection.length} to multi-select (${multiSelectIds.size} total).`
    });
  }

  if (msg.type === "multi-clear-selection") {
    multiSelectIds.clear();
    figma.ui.postMessage(buildSelectionInfo());
    figma.ui.postMessage({ type: "success", message: "Cleared multi-select list." });
  }
};
