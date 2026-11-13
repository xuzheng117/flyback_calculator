(function (root) {
  "use strict";

  const mu0 = 4 * Math.PI * 1e-7;
  const cores = {
    ef25: {
      name: "EF25 · N87", bobbin: "B66208B1110T001", datasheet: "e_25_13_7",
      ae: 52.5, amin: 51.5, al0: 1850, window: 61, fit: [90, -0.731, 0.10, 2.00]
    },
    ef32: {
      name: "EF32 · N87", bobbin: "B66230A1114T001", datasheet: "e_32_16_9",
      ae: 83, amin: 81.4, al0: 2300, window: 108.5, fit: [145, -0.748, 0.10, 2.50]
    },
    etd39: {
      name: "ETD39/20/13 · N87", bobbin: "B66364W1016T001", datasheet: "etd_39_20_13",
      ae: 125, amin: 123, al0: 2700, window: 178, fit: [196, -0.734, 0.10, 3.00]
    },
    etd44: {
      name: "ETD44/22/15 · N87", bobbin: "B66366W1018T001", datasheet: "etd_44_22_15",
      ae: 173, amin: 172, al0: 3500, window: 210, fit: [262, -0.74, 0.10, 3.50]
    },
    etd49: {
      name: "ETD49/25/16 · N87", bobbin: "B66368W1020T001", datasheet: "etd_49_25_16",
      ae: 211, amin: 209, al0: 3800, window: 269.4, fit: [314, -0.741, 0.10, 3.50]
    },
    etd59: {
      name: "ETD59/31/22 · N87", bobbin: "B66398W1024T001", datasheet: "etd_59_31_22",
      ae: 368, amin: 368, al0: 5300, window: 365.6, fit: [508, -0.708, 0.10, 3.50]
    },
    e65: {
      name: "E65/32/27 · N87", bobbin: "B66388B1000T001", datasheet: "e_65_32_27",
      ae: 535, amin: 529, al0: 7900, window: 426, fit: [716, -0.762, 0.20, 5.00]
    }
  };
  const wireSizes = [0.08, 0.10, 0.112, 0.125, 0.14, 0.15, 0.16, 0.18, 0.19, 0.20, 0.224, 0.25, 0.28, 0.30, 0.315, 0.355, 0.40, 0.45, 0.50];
  const area = diameter => Math.PI * diameter ** 2 / 4;
  const boundary = (vin, reflected, inductance, frequency, efficiency) =>
    efficiency * (vin * reflected / (vin + reflected)) ** 2 / (2 * inductance * frequency);

  function transition(power, reflected, inductance, frequency, efficiency) {
    const q = Math.sqrt(2 * inductance * frequency * power / efficiency);
    return q < reflected ? reflected * q / (reflected - q) : Infinity;
  }

  function operatingPoint(vin, power, reflected, inductance, frequency, efficiency) {
    const criticalPower = boundary(vin, reflected, inductance, frequency, efficiency);
    const ratio = power / criticalPower;
    const mode = Math.abs(ratio - 1) < 1e-8 ? "BCM" : ratio > 1 ? "CCM" : "DCM";
    const voltSecondsRate = inductance * frequency;
    const pin = power / efficiency;
    const duty = mode === "DCM" ? Math.sqrt(2 * voltSecondsRate * pin) / vin : reflected / (vin + reflected);
    const ripple = vin * duty / voltSecondsRate;
    const valley = mode === "CCM" ? Math.max(0, pin / (vin * duty) - ripple / 2) : 0;
    const peak = valley + ripple;
    const off = mode === "DCM" ? Math.min(1 - duty, voltSecondsRate * peak / reflected) : 1 - duty;
    const meanSquare = (peak ** 2 + peak * valley + valley ** 2) / 3;
    return { vin, power, mode, criticalPower, duty, peak, valley, ripple, off, idle: Math.max(0, 1 - duty - off),
      primaryRms: Math.sqrt(duty * meanSquare), secondaryRmsFactor: Math.sqrt(off * meanSquare) / (off * (peak + valley) / 2) };
  }

  function selectWire(rms, density, skinDepth) {
    const requiredArea = rms / density;
    const maximumDiameter = wireSizes.filter(size => size <= 2 * skinDepth).at(-1) ?? wireSizes[0];
    const strands = Math.max(1, Math.ceil(requiredArea / area(maximumDiameter)));
    const diameter = wireSizes.find(size => area(size) * strands >= requiredArea) ?? maximumDiameter;
    return { diameter, strands, requiredArea, copper: area(diameter) * strands, equivalent: Math.sqrt(4 * requiredArea / Math.PI) };
  }

  function ratioParts(ratio) {
    const { primary, secondary } = ratio;
    if (![primary, secondary].every(value => Number.isSafeInteger(value) && value > 0)) {
      throw new RangeError("匝比的两项都需要填写正整数。");
    }
    let a = primary;
    let b = secondary;
    while (b !== 0) [a, b] = [b, a % b];
    return { primary: primary / a, secondary: secondary / a };
  }

  function calculate(params) {
    const { vinMin, vinNom, vinMax, dutyLimit, fluxLimit, density, headroom, core, outputs } = params;
    const fixedRatio = params.turnsRatio ? ratioParts(params.turnsRatio) : null;
    const mainVoltage = outputs[0].voltage + outputs[0].drop;
    const reflected = fixedRatio ? fixedRatio.primary / fixedRatio.secondary * mainVoltage : params.reflected;
    const efficiency = params.efficiency / 100;
    const frequency = params.frequency * 1000;
    const power = outputs.reduce((sum, output) => sum + output.power, 0);
    const designVin = { low: vinMin, nominal: vinNom, high: vinMax }[params.target];
    const pTarget = power / efficiency;
    const desiredL = (designVin * reflected / (designVin + reflected)) ** 2 / (2 * frequency * pTarget);
    const dutyCeiling = dutyLimit / 100;
    const clampInductance = vr => dutyCeiling < vr / (vinMin + vr)
      ? (vinMin * dutyCeiling) ** 2 / (2 * frequency * pTarget) : Infinity;
    const recommendedL = Math.min(desiredL, clampInductance(reflected));
    const inductance = params.inductance > 0 ? params.inductance * 1e-6 : recommendedL;
    const targetPrimaryPeak = operatingPoint(vinMin, power, reflected, inductance, frequency, efficiency).peak;
    const targetRatio = reflected / mainVoltage;
    const margin = 1 + headroom / 100;
    const fluxArea = core.amin * 1e-6;
    const minTurns = Math.max(1, Math.ceil(inductance * targetPrimaryPeak * margin / (fluxArea * fluxLimit)));
    const windingScale = fixedRatio ? Math.ceil(minTurns / fixedRatio.primary) : 1;
    const mainTurns = fixedRatio ? windingScale * fixedRatio.secondary : Math.max(1, Math.round(minTurns / targetRatio));
    let primaryTurns = fixedRatio ? windingScale * fixedRatio.primary : minTurns;
    if (!Number.isSafeInteger(primaryTurns) || !Number.isSafeInteger(mainTurns)) {
      throw new RangeError("计算匝数超出范围。请使用更简单的整数匝比。");
    }
    let actualReflected = primaryTurns / mainTurns * mainVoltage;
    let low = operatingPoint(vinMin, power, actualReflected, inductance, frequency, efficiency);
    // Automatic mode can adjust the ratio to satisfy the flux limit after rounding.
    while (!fixedRatio && inductance * low.peak * margin / (primaryTurns * fluxArea) > fluxLimit + 1e-12) {
      primaryTurns += 1;
      actualReflected = primaryTurns / mainTurns * mainVoltage;
      low = operatingPoint(vinMin, power, actualReflected, inductance, frequency, efficiency);
    }
    const point = (vin, load = power) => operatingPoint(vin, load, actualReflected, inductance, frequency, efficiency);
    const criticalVin = transition(power, actualReflected, inductance, frequency, efficiency);
    const fullLoad = [low, point(vinNom), point(vinMax)];
    const samples = [...fullLoad];
    if (criticalVin > vinMin && criticalVin < vinMax) samples.push(point(criticalVin));
    for (let i = 1; i < 160; i += 1) samples.push(point(vinMin + (vinMax - vinMin) * i / 160));
    const maxPeak = Math.max(...samples.map(sample => sample.peak));
    const maxDuty = Math.max(...samples.map(sample => sample.duty));
    const primaryRms = Math.max(...samples.map(sample => sample.primaryRms));
    const secondaryRmsFactor = Math.max(...samples.map(sample => sample.secondaryRmsFactor));
    const skinDepth = Math.sqrt(1.724e-8 / (Math.PI * frequency * mu0)) * 1000;
    const primary = { turns: primaryTurns, rms: primaryRms, ...selectWire(primaryRms, density, skinDepth) };
    const secondary = outputs.map((output, index) => {
      const turns = index === 0 ? mainTurns : Math.max(1, Math.round(primaryTurns * (output.voltage + output.drop) / actualReflected));
      if (!Number.isSafeInteger(turns)) {
        throw new RangeError("辅助绕组匝数超出范围。请复核匝比和输出电压。");
      }
      const ratio = primaryTurns / turns;
      const current = output.power / output.voltage;
      const rms = current * secondaryRmsFactor;
      const estimatedVoltage = Math.max(0, actualReflected / ratio - output.drop);
      return { ...output, turns, ratio, current, rms, estimatedVoltage, piv: estimatedVoltage + vinMax / ratio, ...selectWire(rms, density, skinDepth) };
    });
    const al = inductance * 1e9 / primaryTurns ** 2;
    const equivalentGap = al >= core.al0 ? null : mu0 * core.ae * 1e-6 * (1 / al - 1 / core.al0) * 1e12;
    const fit = core.fit;
    const fittedGap = fit ? (al / fit[0]) ** (1 / fit[1]) : null;
    const physicalGap = equivalentGap !== null && fit && fittedGap > fit[2] && fittedGap < fit[3] ? fittedGap : null;
    const copperArea = [primary, ...secondary].reduce((sum, winding) => sum + winding.turns * winding.copper, 0);
    const fill = copperArea / core.window;
    const flux = inductance * maxPeak / (primaryTurns * fluxArea);
    const swing = inductance * Math.max(...samples.map(sample => sample.ripple)) / (primaryTurns * fluxArea);
    return {
      power, inputPower: pTarget, designVin, desiredL, recommendedL, inductance, fullLoad, criticalVin, actualReflected,
      maxPeak, maxDuty, flux, designFlux: flux * margin, swing, al, equivalentGap, physicalGap, skinDepth, primary, secondary, fill,
      vds: vinMax + actualReflected, clamped: recommendedL < desiredL,
      point, boundaryPower: vin => boundary(vin, actualReflected, inductance, frequency, efficiency),
      transitionAt: load => transition(load, actualReflected, inductance, frequency, efficiency)
    };
  }

  const model = { cores, boundary, transition, operatingPoint, calculate };
  if (typeof module !== "undefined" && module.exports) module.exports = model;
  else root.Flyback = model;
})(globalThis);
