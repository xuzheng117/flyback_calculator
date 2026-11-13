"use strict";

const form = document.querySelector("#design");
const outputsElement = document.querySelector("#outputs");
const countSelect = document.querySelector("#output-count");
const coreSelect = document.querySelector("#core");
const ratioMode = document.querySelector("#ratio-mode");
const loadSlider = document.querySelector("#load");
const structureSelect = document.querySelector("#structure");
const $ = id => document.getElementById(id);
const number = (value, digits = 1) => Number.isFinite(value) ? value.toFixed(digits) : "—";
const percent = value => number(value * 100) + "%";
const unit = (value, suffix, digits = 1) => number(value, digits) + " " + suffix;
const close = (a, b) => Math.abs(a - b) <= 1e-7 * Math.max(1, Math.abs(b));
const defaultOutputs = [
  { voltage: 12, power: 70, drop: 0.7 },
  { voltage: 12, power: 70, drop: 0.7 }
];
const inputs = [
  ["vinMin", "最低", "V", 180, 0.5, 1200],
  ["vinNom", "额定", "V", 600, 0.5, 1200],
  ["vinMax", "最高", "V", 1000, 0.5, 1200]
];
const switching = [
  ["frequency", "开关频率", "kHz", 65, 1, 1000],
  ["efficiency", "预估效率", "%", 88, 1, 100],
  ["dutyLimit", "最大占空比", "%", 55, 1, 95]
];
const reflectedField = ["reflected", "目标反射电压", "V", 139.7, 0.5, 1200];
const defaultCore = "etd49";
const advanced = [
  ["inductance", "自定义初级感量", "µH", "", 0.1, 100000, "使用推荐值"],
  ["fluxLimit", "峰值磁通上限", "T", 0.23, 0.01, 0.8],
  ["density", "电流密度", "A/mm²", 4, 0.1, 20],
  ["headroom", "峰值电流裕量", "%", 15, 0, 100]
];
const custom = [
  ["ae", "有效截面 Ae", "mm²", 52.5, 1, 2000],
  ["amin", "最小截面 Amin", "mm²", 51.5, 1, 2000],
  ["al0", "无气隙 AL", "nH/匝²", 1850, 1, 20000],
  ["window", "骨架绕线截面", "mm²", 61, 1, 4000]
];
let result;
let parameters;
let outputCache = [];

function field([name, label, suffix, value, min, max, placeholder]) {
  return '<label class="field"><span>' + label + '</span><span class="input-wrap"><input type="number" inputmode="decimal" name="' + name +
    '" value="' + value + '" min="' + min + '" max="' + max + '" step="any" ' + (placeholder ? 'placeholder="' + placeholder + '"' : "required") +
    '><span aria-hidden="true">' + suffix + "</span></span></label>";
}

function outputRows(count, capture = true) {
  if (capture) {
    for (const row of outputsElement.children) {
      outputCache[Number(row.dataset.index)] = Object.fromEntries([...row.querySelectorAll("input")].map(input => [input.name.split("-")[0], input.value]));
    }
  }
  outputsElement.innerHTML = Array.from({ length: count }, (_, index) => {
    const output = outputCache[index] ?? defaultOutputs[index] ?? { voltage: 5, power: 5, drop: 0.45 };
    const fields = [
      ["voltage-" + index, "电压", "V", output.voltage, 0.1, 1000],
      ["power-" + index, "功率", "W", output.power, 0.01, 10000],
      ["drop-" + index, "整流压降", "V", output.drop, 0, 10]
    ];
    return '<fieldset class="output-row" data-index="' + index + '"><legend><span class="output-tag">' + (index === 0 ? "主反馈" : "辅助") +
      '</span> OUT ' + (index + 1) + '</legend><div class="field-grid three">' + fields.map(field).join("") + "</div></fieldset>";
  }).join("");
  updateTotal();
}

function updateTotal() {
  const total = [...outputsElement.querySelectorAll('[name^="power-"]')].reduce((sum, input) => sum + (input.valueAsNumber || 0), 0);
  $("total-power").innerHTML = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 3 }).format(total) + ' <small>W</small>';
}

function updateCore() {
  const isCustom = coreSelect.value === "custom";
  $("core-fields").hidden = !isCustom;
  for (const input of $("core-fields").querySelectorAll("input")) input.disabled = !isCustom;
  const core = Flyback.cores[coreSelect.value];
  $("core-info").textContent = core
    ? "骨架 " + core.bobbin + " · 有效截面 Ae " + core.ae + " mm² · 最小截面 Amin " + core.amin +
      " mm² · 骨架绕线截面 " + core.window + " mm² · 无气隙 AL " + core.al0 + " nH/匝²"
    : "按磁芯与骨架资料填写。自定义磁芯输出等效气隙。";
  const datasheet = $("core-datasheet");
  datasheet.hidden = !core;
  if (core) datasheet.href = "https://www.tdk-electronics.tdk.com/inf/80/db/fer/" + core.datasheet + ".pdf";
}

function updateRatio() {
  const isCustom = ratioMode.value === "custom";
  const { reflected, ratioPrimary, ratioSecondary } = form.elements;
  $("reflected-field").hidden = isCustom;
  reflected.disabled = isCustom;
  $("ratio-fields").hidden = !isCustom;
  ratioPrimary.disabled = !isCustom;
  ratioSecondary.disabled = !isCustom;
  const note = $("ratio-note");
  note.hidden = !isCustom;
  if (!isCustom) return;
  const primary = ratioPrimary.valueAsNumber;
  const secondary = ratioSecondary.valueAsNumber;
  const voltage = form.elements.namedItem("voltage-0");
  const drop = form.elements.namedItem("drop-0");
  const valid = [ratioPrimary, ratioSecondary, voltage, drop].every(input => input.validity.valid);
  const voltageText = valid ? "当前反射电压 " + unit(primary / secondary * (voltage.valueAsNumber + drop.valueAsNumber), "V", 2) + "。" : "";
  note.textContent = voltageText + "用两个正整数填写比例，例如 7:2 表示 3.5:1。";
}

function readParameters() {
  const get = name => form.elements.namedItem(name).valueAsNumber;
  const values = Object.fromEntries([...inputs, ...switching, ...advanced].map(([name]) => [name, get(name)]));
  const core = Flyback.cores[coreSelect.value] ?? { name: "自定义磁芯", ...Object.fromEntries(custom.map(([name]) => [name, get(name)])) };
  return {
    ...values,
    reflected: get("reflected"),
    turnsRatio: ratioMode.value === "custom"
      ? { primary: get("ratioPrimary"), secondary: get("ratioSecondary") }
      : null,
    inductance: values.inductance || 0,
    target: form.elements.target.value,
    core,
    outputs: Array.from({ length: Number(countSelect.value) }, (_, index) => ({
      voltage: get("voltage-" + index), power: get("power-" + index), drop: get("drop-" + index)
    }))
  };
}

function markPending() {
  $("pending").hidden = false;
  $("result-status").textContent = "待更新";
  $("result-status").parentElement.classList.add("stale");
  $("form-error").hidden = true;
}

function modeLabel(mode) {
  return '<span class="mode ' + mode.toLowerCase() + '">' + mode + "</span>";
}

function metric(label, value, suffix, detail, style = "") {
  return '<article class="metric ' + style + '"><div class="metric-label">' + label + '</div><div class="metric-value">' + value +
    (suffix ? ' <small>' + suffix + '</small>' : '') + '</div><p>' + detail + '</p></article>';
}

function drawMetrics() {
  const r = result;
  const low = r.fullLoad[0];
  const customL = parameters.inductance > 0;
  const threshold = Number.isFinite(r.criticalVin);
  $("metrics").innerHTML = [
    metric(customL ? "采用的初级感量 Lp" : "推荐初级感量 Lp", number(r.inductance * 1e6, 2), "µH",
      customL ? "推荐值 " + unit(r.recommendedL * 1e6, "µH", 2) : (r.clamped ? "已按占空比上限收敛" : "按满载临界点反推"), "featured"),
    metric("满载 CCM 临界输入", threshold ? number(r.criticalVin, 2) : "全程 CCM", threshold ? "V" : "",
      threshold ? "低于临界电压进入 CCM" : "模型下无有限临界电压", "threshold"),
    metric("最低输入 · 满载", modeLabel(low.mode), "", "占空比 " + percent(low.duty) + " · 峰值 " + unit(low.peak, "A", 2), "point-card")
  ].join("");
}

function drawChart(load, critical) {
  const r = result;
  const { vinMin, vinMax, vinNom } = parameters;
  const delta = vinMax - vinMin || vinNom * 0.2;
  const xMin = vinMin === vinMax ? vinNom - delta : vinMin;
  const xMax = vinMin === vinMax ? vinNom + delta : vinMax;
  const yMax = Math.max(r.power * 1.20, load * 1.20, r.boundaryPower(xMax) * 1.10);
  const w = Math.max(260, $("chart").clientWidth);
  const compact = w < 450;
  const h = compact ? 212 : 264;
  const x0 = compact ? 47 : 58;
  const x1 = w - (compact ? 25 : 37);
  const y0 = 20, y1 = h - 37;
  const sx = v => x0 + (v - xMin) / (xMax - xMin) * (x1 - x0);
  const sy = p => y1 - p / yMax * (y1 - y0);
  const yLoad = sy(load);
  const lines = [];
  const labels = [];
  for (let i = 0; i <= 4; i += 1) {
    const yy = sy(yMax * i / 4);
    lines.push('<path d="M' + x0 + ' ' + yy + 'H' + x1 + '"/>');
    const power = yMax * i / 4;
    labels.push('<text text-anchor="end" x="' + (x0 - 8) + '" y="' + (yy + 4) + '">' + number(power, yMax < 1 ? 2 : yMax < 10 ? 1 : 0) + "</text>");
  }
  const voltTicks = vinMin === vinMax ? [vinNom] : [...new Set([vinMin, vinNom, vinMax])];
  const axisTicks = voltTicks.length === 3 && (vinNom - vinMin < delta * 0.14 || vinMax - vinNom < delta * 0.14) ? [vinMin, vinMax] : voltTicks;
  for (const voltage of voltTicks) {
    const xx = sx(voltage);
    lines.push('<path d="M' + xx + ' ' + y0 + 'V' + y1 + '"/>');
  }
  for (const voltage of axisTicks) {
    labels.push('<text text-anchor="middle" x="' + sx(voltage) + '" y="' + (y1 + 19) + '">' + number(voltage, delta < 1 ? 2 : voltage % 1 ? 1 : 0) + "</text>");
  }
  const curve = Array.from({ length: 61 }, (_, i) => {
    const vin = xMin + (xMax - xMin) * i / 60;
    return (i === 0 ? "M" : "L") + number(sx(vin), 2) + " " + number(sy(r.boundaryPower(vin)), 2);
  }).join(" ");
  const crossing = Number.isFinite(critical) && critical >= xMin && critical <= xMax;
  const crossX = crossing ? sx(critical) : 0;
  const crossLabel = crossing && Math.abs(yLoad - y0) > 18
    ? '<text class="cross-label" x="' + (crossX + (crossX > w / 2 ? -10 : 10)) + '" text-anchor="' + (crossX > w / 2 ? "end" : "start") +
      '" y="' + (yLoad - 10) + '">' + unit(critical, "V", 2) + "</text>" : "";
  $("chart").innerHTML = '<svg viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="CCM 和 DCM 的负载边界，曲线上方为 CCM，曲线下方为 DCM">' +
    '<defs><linearGradient id="ccm-fill" x1="0" y1="0" x2="0" y2="1" gradientUnits="objectBoundingBox"><stop stop-color="#10b981" stop-opacity=".32"/><stop offset="1" stop-color="#10b981" stop-opacity=".08"/></linearGradient>' +
    '<linearGradient id="dcm-fill" x1="0" y1="0" x2="0" y2="1" gradientUnits="objectBoundingBox"><stop stop-color="#60a5fa" stop-opacity=".20"/><stop offset="1" stop-color="#60a5fa" stop-opacity=".06"/></linearGradient></defs>' +
    '<path d="' + curve + ' L' + x1 + ' ' + y0 + ' H' + x0 + ' Z" fill="url(#ccm-fill)"/><path d="' + curve + ' L' + x1 + ' ' + y1 + ' H' + x0 + ' Z" fill="url(#dcm-fill)"/>' +
    '<g class="chart-grid">' + lines.join("") + '</g><path class="chart-axis" d="M' + x0 + ' ' + y0 + 'V' + y1 + 'H' + x1 + '"/><g class="axis-label">' + labels.join("") +
    '<text x="' + (x0 - 1) + '" y="12">Pout (W)</text><text text-anchor="end" x="' + x1 + '" y="' + (h - 3) + '">Vin (V)</text></g>' +
    '<path class="boundary-line" d="' + curve + '"/><path class="load-line" d="M' + x0 + ' ' + yLoad + 'H' + x1 + '"/>' +
    (crossing ? '<path class="cross-line" d="M' + crossX + ' ' + yLoad + 'V' + y1 + '"/><circle class="cross-dot" cx="' + crossX + '" cy="' + yLoad + '" r="4.5"/>' + crossLabel : "") +
    '</svg>';
}

function drawLoad() {
  if (!result) return;
  const load = result.power * Number(loadSlider.value) / 100;
  const critical = result.transitionAt(load);
  $("load-percent").textContent = loadSlider.value + "%";
  $("load-watts").textContent = unit(load, "W");
  $("points-load").textContent = loadSlider.value + "% 负载";
  loadSlider.style.setProperty("--progress", ((Number(loadSlider.value) - 5) / 95 * 100) + "%");
  drawChart(load, critical);
  const { vinMin, vinNom, vinMax } = parameters;
  let insight;
  if (!Number.isFinite(critical)) insight = "在当前负载下，模型预测所有输入电压均为 CCM。";
  else if (vinMin === vinMax && close(critical, vinMin)) insight = "在当前输入电压下处于 BCM 临界点。";
  else if (close(critical, vinMin)) insight = "最低输入处于 BCM 临界点，更高输入进入 DCM。";
  else if (close(critical, vinMax)) insight = "最高输入处于 BCM 临界点，更低输入处于 CCM。";
  else if (critical < vinMin) insight = "临界点 " + unit(critical, "V", 2) + " 低于输入范围，当前负载下全输入范围为 DCM。";
  else if (critical > vinMax) insight = "临界点 " + unit(critical, "V", 2) + " 高于输入范围，当前负载下全输入范围为 CCM。";
  else insight = "在 " + unit(critical, "V", 2) + " 处为 BCM。输入低于该电压时为 CCM，高于该电压时为 DCM。";
  $("chart-insight").innerHTML = '<span class="insight-icon" aria-hidden="true">i</span><span>' + insight + "</span>";
  $("points").innerHTML = [vinMin, vinNom, vinMax].map((vin, index) => {
    const p = result.point(vin, load);
    return '<tr><td>' + ["最低", "额定", "最高"][index] + ' <span class="table-sub">' + unit(vin, "V", vin % 1 ? 2 : 0) + '</span></td><td>' + modeLabel(p.mode) +
      '</td><td>' + percent(p.duty) + '</td><td>' + unit(p.peak, "A", 2) + '</td><td>' + unit(p.primaryRms, "A", 2) + '</td></tr>';
  }).join("");
}

function drawWinding() {
  if (!result) return;
  const r = result;
  const wantsFeedbackSplit = structureSelect.value === "split-feedback";
  const splitPrimary = structureSelect.value !== "simple" && r.primary.turns >= 2;
  const feedback = r.secondary[0];
  const splitFeedback = wantsFeedbackSplit && splitPrimary && feedback.turns >= 2;
  const firstPrimary = splitPrimary ? Math.ceil(r.primary.turns / 2) : r.primary.turns;
  const windingRow = (id, label, winding, turns, color, side) =>
    ({ id, name: label + " " + id, detail: turns + " 匝 · " + wireLabel(winding), color, side });
  const bias = { id: "VCC", name: "辅助供电 VCC", detail: "匝数待定", color: "bias", side: "primary" };
  const primaryRow = (id, turns) => windingRow(id, "初级", r.primary, turns, "primary", "primary");
  const feedbackRow = (id, turns) => windingRow(id, "主反馈", feedback, turns, "feedback", "secondary");
  const otherSecondaries = r.secondary.slice(1).map((winding, index) =>
    windingRow("S" + (index + 2), "次级", winding, winding.turns, "secondary", "secondary"));
  const windings = [primaryRow(splitPrimary ? "P1" : "Np", firstPrimary)];
  if (splitFeedback) {
    const firstFeedback = Math.ceil(feedback.turns / 2);
    windings.push(
      feedbackRow("S1a", firstFeedback),
      ...otherSecondaries,
      bias,
      feedbackRow("S1b", feedback.turns - firstFeedback)
    );
  } else {
    windings.push(bias, feedbackRow("S1", feedback.turns), ...otherSecondaries);
  }
  if (splitPrimary) {
    windings.push(primaryRow("P2", r.primary.turns - firstPrimary));
  }

  const layers = [];
  for (const [index, winding] of windings.entries()) {
    const inner = windings[index - 1];
    if (inner && inner.side !== winding.side) {
      layers.push({ name: "初次级绝缘层", detail: "厚度与材料待核验", color: "insulation" });
    } else if (inner && winding === bias) {
      layers.push({ name: "初级侧层间绝缘", detail: "按绕组电压确定", color: "insulation" });
    }
    layers.push(winding);
  }

  const sequence = windings.map(winding => winding.id).join(" → ");
  $("diagram").innerHTML = '<div class="diagram-origin"><span>骨架</span><span>从内到外</span></div>' +
    '<p class="winding-sequence">' + sequence + '</p><ol class="layers">' +
    layers.map(layer => '<li class="' + layer.color + '"><span class="layer-bar" aria-hidden="true"></span><strong>' + layer.name + '</strong><span>' + layer.detail + "</span></li>").join("") + "</ol>";

  const notes = [];
  if (splitFeedback) {
    notes.push("P1 与 P2、S1a 与 S1b 分别同相串联。");
  } else if (wantsFeedbackSplit) {
    notes.push("双分段要求初级和主反馈各至少 2 匝，当前显示可实现的结构。");
  } else if (structureSelect.value === "split" && !splitPrimary) {
    notes.push("初级分段至少需要 2 匝，当前显示单段初级。");
  }
  if (splitPrimary && !splitFeedback) notes.push("P1 与 P2 同相串联。");
  notes.push("VCC 为初级侧辅助供电。匝数和线径待定，填充率暂未计入 VCC。");
  $("diagram-note").textContent = notes.join("");
}

function wireLabel(winding) {
  return (winding.strands > 1 ? winding.strands + " × " : "") + "Ø" + String(winding.diameter) + " mm";
}

function drawMagnetics() {
  const r = result;
  const gap = r.physicalGap ?? r.equivalentGap;
  $("mag-metrics").innerHTML = [
    metric("初级匝数 Np", r.primary.turns, "匝", parameters.core.name + " · 主反馈匝比 " +
      r.primary.turns + ":" + r.secondary[0].turns + " · 反射电压 " + unit(r.actualReflected, "V", 2)),
    metric(r.physicalGap !== null ? "中柱气隙估算" : "等效总气隙", gap === null ? "—" : number(gap, 3), gap === null ? "" : "mm", "目标 AL " + unit(r.al, "nH/匝²")),
    metric("峰值磁通 · 含裕量", number(r.designFlux, 3), "T", "满载 Bpk " + unit(r.flux, "T", 3) + " · ΔB " + unit(r.swing, "T", 3)),
    metric("窗口裸铜填充率", percent(r.fill), "", "按骨架绕线截面估算")
  ].join("");
  const pri = r.primary;
  $("wires").innerHTML = '<tr><td><span class="winding-dot pri"></span>初级 P</td><td>' + pri.turns + '</td><td>' + unit(pri.rms, "A", 2) +
    '</td><td>' + wireLabel(pri) + '</td><td title="最高输入时的 MOSFET 理想关断电压">VDS ' + unit(r.vds, "V") + '</td></tr>' +
    r.secondary.map((s, index) => '<tr><td><span class="winding-dot sec"></span>次级 S' + (index + 1) + (index === 0 ? ' <span class="table-sub">反馈</span>' : "") +
      '</td><td>' + s.turns + '</td><td>' + unit(s.rms, "A", 2) + '</td><td>' + wireLabel(s) + '</td><td title="理想匝比下的估算输出电压">' + unit(s.estimatedVoltage, "V", 2) + '</td></tr>').join("");
  $("wires-note").textContent = "整流器反压估算  " + r.secondary.map((s, i) => "S" + (i + 1) + " " + unit(s.piv, "V")).join(" · ") +
    "。关断电压与反压均需另计漏感尖峰。次级 RMS 假设各路电流按负载比例分担，集肤深度约 " + unit(r.skinDepth, "mm", 3) + "。";
  const warnings = [];
  if (r.maxDuty > parameters.dutyLimit / 100 + 1e-7) warnings.push("满载所需占空比 " + percent(r.maxDuty) + " 超出设定上限。调整匝比设定或采用的感量后复算。");
  if (r.equivalentGap === null) warnings.push("目标 AL 达到或超过该磁芯的无气隙 AL，需复核磁芯与匝数。");
  else if (r.physicalGap === null && parameters.core.fit) warnings.push("气隙超出磁芯数据表拟合范围，当前显示磁路等效值。");
  if (r.fill > 0.35) warnings.push("裸铜已占用 " + percent(r.fill) + " 的绕线截面。请用线材实际外径、绝缘层和边距核对排绕空间。");
  const deviations = r.secondary.map((s, index) => ({ ...s, index })).filter(s => Math.abs(s.estimatedVoltage / s.voltage - 1) > 0.05);
  if (deviations.length) warnings.push(deviations.map(s => "S" + (s.index + 1) + " 估算 " + unit(s.estimatedVoltage, "V", 2) + "，目标 " + unit(s.voltage, "V")).join("；") + "。需复核整数匝比和交叉调整。");
  if (r.secondary.length > 1) warnings.push("多路输出以 OUT 1 为主反馈，辅助输出电压会随各路负载变化。");
  $("warnings").innerHTML = warnings.map(message => '<div class="warning"><span aria-hidden="true">◇</span>' + message + "</div>").join("");
  drawWinding();
}

function validateNativeFields() {
  const invalid = [...form.elements].find(control => control.willValidate && !control.validity.valid);
  if (!invalid) return true;
  const details = invalid.closest("details");
  if (details) details.open = true;
  invalid.reportValidity();
  return false;
}

function submit() {
  if (!validateNativeFields()) return;
  const next = readParameters();
  let error = "";
  if (next.vinMin > next.vinNom || next.vinNom > next.vinMax) error = "请按「最低 ≤ 额定 ≤ 最高」填写输入电压。";
  else if (next.core.amin > next.core.ae) error = "磁芯最小截面 Amin 应小于或等于有效截面 Ae。";
  if (!error) {
    try {
      result = Flyback.calculate(next);
    } catch (failure) {
      if (!(failure instanceof RangeError)) throw failure;
      error = failure.message;
    }
  }
  $("form-error").hidden = !error;
  $("form-error").textContent = error;
  if (error) {
    if (next.core.amin > next.core.ae) $("core-fields").closest("details").open = true;
    return;
  }
  parameters = next;
  $("pending").hidden = true;
  $("result-status").textContent = "已计算";
  $("result-status").parentElement.classList.remove("stale");
  drawMetrics();
  drawLoad();
  drawMagnetics();
}

$("input-fields").innerHTML = inputs.map(field).join("");
$("switch-fields").innerHTML = switching.map(field).join("");
$("reflected-field").innerHTML = field(reflectedField);
$("advanced-fields").innerHTML = advanced.map(field).join("");
$("core-fields").innerHTML = custom.map(field).join("");
for (const [id, core] of Object.entries(Flyback.cores)) {
  const option = new Option("TDK " + core.name, id, id === defaultCore, id === defaultCore);
  coreSelect.add(option, coreSelect.options[coreSelect.options.length - 1]);
}
outputRows(Number(countSelect.value));
updateCore();
updateRatio();
form.noValidate = true;
form.addEventListener("submit", event => {
  event.preventDefault();
  submit();
});
form.addEventListener("input", event => {
  if (event.target === countSelect) outputRows(Number(countSelect.value));
  if (event.target === coreSelect) updateCore();
  if (event.target.name?.startsWith("power-")) updateTotal();
  updateRatio();
  markPending();
});
$("reset").addEventListener("click", () => {
  outputCache = [];
  form.reset();
  countSelect.value = "2";
  outputRows(2, false);
  updateCore();
  updateRatio();
  loadSlider.value = "100";
  structureSelect.value = "split";
  submit();
});
loadSlider.addEventListener("input", drawLoad);
structureSelect.addEventListener("change", drawWinding);
window.addEventListener("resize", drawLoad);
submit();

const sectionLinks = document.querySelectorAll(".top-inner nav a");
function updateSectionLink() {
  const current = [...sectionLinks].find(link => link.hash === location.hash) ?? sectionLinks[0];
  for (const link of sectionLinks) {
    if (link === current) link.setAttribute("aria-current", "location");
    else link.removeAttribute("aria-current");
  }
}
window.addEventListener("hashchange", updateSectionLink);
updateSectionLink();
