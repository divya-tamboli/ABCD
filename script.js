(() => {
  "use strict";

  // RoutePulse: synthetic campus transport simulation.
  // This is a demo model, not live GPS data.

  const CONFIG = {
    fleetSize: 15,
    start: 480, // 08:00
    end: 600,   // 10:00
    turnaround: 5,

    stops: [
      "North Gate",
      "Library",
      "Science Quad",
      "Student Center",
      "West Residence",
      "Athletics"
    ],

    routes: [
      {
        id: "A", vehicle: "Bus 04", capacity: 40,
        stops: ["North Gate", "Library", "Student Center"],
        departures: [495, 525, 555, 585],
        offsets: [0, 13, 16], runtime: 18
      },
      {
        id: "B", vehicle: "Bus 09", capacity: 32,
        stops: ["West Residence", "Science Quad", "Student Center"],
        departures: [500, 530, 560, 590],
        offsets: [0, 5, 10], runtime: 12
      },
      {
        id: "C", vehicle: "Bus 12", capacity: 40,
        stops: ["Library", "Athletics", "West Residence"],
        departures: [510, 540, 570],
        offsets: [0, 6, 12], runtime: 14
      },
      {
        id: "D", vehicle: "Bus 07", capacity: 32,
        stops: ["North Gate", "Science Quad", "Athletics"],
        departures: [515, 545, 575],
        offsets: [0, 5, 10], runtime: 12
      },
      {
        id: "E", vehicle: "Bus 02", capacity: 40,
        stops: ["Library", "West Residence"],
        departures: [520, 550, 580],
        offsets: [0, 8], runtime: 10
      },
      {
        id: "F", vehicle: "Bus 06", capacity: 40,
        stops: ["Student Center", "Athletics"],
        departures: [530, 560, 590],
        offsets: [0, 7], runtime: 9
      }
    ],

    demand: {
      "North Gate":       [5, 7, 10, 8, 5, 3, 2, 1],
      "Library":          [6, 8, 12, 10, 7, 4, 2, 1],
      "Science Quad":     [7, 11, 17, 13, 9, 5, 2, 1],
      "Student Center":   [8, 10, 15, 12, 8, 4, 2, 1],
      "West Residence":   [5, 8, 11, 8, 6, 3, 2, 2],
      "Athletics":        [3, 4, 6, 4, 4, 2, 1, 1]
    },

    spareBus: {
      vehicle: "Bus 15",
      capacity: 40,
      availableFrom: 480
    },

    connection: {
      from: "A",
      to: "C",
      stop: "Library",
      riders: 8,
      maxHold: 3,
      slack: 5
    }
  };

  const SCENARIOS = {
    normal: {
      name: "Normal operations",
      demandMultiplier: 1,
      delays: { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0 },
      unavailable: [],
      event: null
    },

    traffic: {
      name: "Traffic delay +12 min",
      demandMultiplier: 1,
      delays: { A: 5, B: 12, C: 0, D: 5, E: 4, F: 4 },
      unavailable: [],
      event: null
    },

    surge: {
      name: "Demand spike +35%",
      demandMultiplier: 1.35,
      delays: { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0 },
      unavailable: [],
      event: null
    },

    offline: {
      name: "Vehicle unavailable (1 bus)",
      demandMultiplier: 1,
      delays: { A: 0, B: 5, C: 0, D: 0, E: 0, F: 0 },
      unavailable: ["Bus 09"],
      event: null
    },

    campusEvent: {
      name: "Campus event: Science Quad",
      demandMultiplier: 1,
      delays: { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0 },
      unavailable: [],
      event: {
        stop: "Science Quad",
        window: 2,
        riders: 24
      }
    }
  };

  const $ = id => document.getElementById(id);
  const state = {
    scenario: "normal",
    optimizationCalculated: false,
    adjustmentApplied: false,
    fullPlanApplied: false,
    activePlan: "baseline",
    zoom: 1,
    showFourWindows: false,
    showLabels: true
  };

  function setText(id, value) {
    const element = $(id);
    if (element) element.textContent = String(value);
  }

  function formatTime(minutes) {
    const hour = Math.floor(minutes / 60);
    const minute = Math.round(minutes % 60);

    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }

  function mean(values) {
    return values.length
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : 0;
  }

  function getDemand(scenarioKey) {
    const scenario = SCENARIOS[scenarioKey];
    const demand = {};
    for (const [stop, windows] of Object.entries(CONFIG.demand)) {
      demand[stop] = windows.map((value, index) => {
        let result = Math.round(value * scenario.demandMultiplier);

        if (
          scenario.event &&
          scenario.event.stop === stop &&
          scenario.event.window === index
        ) {
          result += scenario.event.riders;
        }

        return result;
      });
    }

    return demand;
  }

  function buildTrips(scenarioKey, planType) {
    const scenario = SCENARIOS[scenarioKey];
    const trips = [];
    const proposed = planType !== "baseline";

    for (const route of CONFIG.routes) {
      const unavailable = scenario.unavailable.includes(route.vehicle);

      for (let index = 0; index < route.departures.length; index++) {
        const departure = route.departures[index];

        if (unavailable && !proposed) continue;

        trips.push({
          route,
          departure,
          vehicle: unavailable
            ? CONFIG.spareBus.vehicle
            : route.vehicle,
          capacity: unavailable
            ? CONFIG.spareBus.capacity
            : route.capacity,
          runtime: route.runtime + (scenario.delays[route.id] || 0),
          supplemental: false,
          index
        });
      }
    }

    // The selected adjustment adds one trip; the full plan adds both.
    if (scenarioKey !== "offline" && proposed) {
      const routeB = CONFIG.routes.find(route => route.id === "B");
      const departures = planType === "adjustment" ? [510] : [510, 540];

      for (const departure of departures) {
        trips.push({
          route: routeB,
          departure,
          vehicle: CONFIG.spareBus.vehicle,
          capacity: CONFIG.spareBus.capacity,
          runtime: routeB.runtime + (scenario.delays.B || 0),
          supplemental: true,
          index: 0
        });
      }
    }

    return trips.sort((a, b) => a.departure - b.departure);
  }

  function simulate(scenarioKey, planType) {
    const scenario = SCENARIOS[scenarioKey];
    const demand = getDemand(scenarioKey);
    const trips = buildTrips(scenarioKey, planType);

    const queues = new Map();

    for (const [stop, windows] of Object.entries(demand)) {
      const queue = [];

      windows.forEach((count, index) => {
        if (count > 0) {
          queue.push({
            arrival: CONFIG.start + index * 15 + 7.5,
            count
          });
        }
      });

      queues.set(stop, queue);
    }

    // A small, explicit synthetic transfer group.
    const transferRiders = Math.round(
      CONFIG.connection.riders * scenario.demandMultiplier
    );

    const libraryQueue = queues.get("Library") || [];
    libraryQueue.push({
      arrival: 8 * 60 + 27,
      count: transferRiders,
      transfer: true
    });
    libraryQueue.sort((a, b) => a.arrival - b.arrival);
    queues.set("Library", libraryQueue);

    const events = [];

    for (const trip of trips) {
      trip.load = 0;
      trip.boarded = 0;

      trip.route.stops.forEach((stop, index) => {
        const time = trip.departure +
          trip.route.offsets[index] *
          (trip.runtime / trip.route.runtime);

        events.push({ trip, stop, time });
      });
    }

    events.sort((a, b) => a.time - b.time);

    let boardedTotal = 0;
    let weightedWait = 0;
    let capacityAlerts = 0;

    for (const event of events) {
      const queue = queues.get(event.stop);
      if (!queue) continue;

      const ready = [];
      const waiting = [];

      for (const group of queue) {
        if (group.arrival <= event.time) ready.push(group);
        else waiting.push(group);
      }

      let seats = Math.max(0, event.trip.capacity - event.trip.load);
      const remaining = [];

      for (const group of ready) {
        const boarded = Math.min(group.count, seats);

        if (boarded > 0) {
          boardedTotal += boarded;
          event.trip.boarded += boarded;
          event.trip.load += boarded;
          seats -= boarded;

          weightedWait += boarded *
            Math.max(0, event.time - group.arrival);
        }
        if (boarded < group.count) {
          remaining.push({
            ...group,
            count: group.count - boarded
          });
          capacityAlerts++;
        }
      }

      queues.set(
        event.stop,
        [...remaining, ...waiting].sort((a, b) => a.arrival - b.arrival)
      );
    }

    let unmet = 0;

    for (const queue of queues.values()) {
      for (const group of queue) {
        unmet += group.count;
        weightedWait += group.count *
          Math.max(0, CONFIG.end - group.arrival);
      }
    }

    const passengers = Object.values(demand)
      .flat()
      .reduce((sum, value) => sum + value, 0) + transferRiders;

    const onTimeTrips = trips.filter(trip =>
      trip.runtime <= trip.route.runtime + 5
    ).length;

    // Check whether the same bus has enough time to finish and turn around.
    const vehicleTrips = new Map();

    for (const trip of trips) {
      if (!vehicleTrips.has(trip.vehicle)) {
        vehicleTrips.set(trip.vehicle, []);
      }

      vehicleTrips.get(trip.vehicle).push(trip);
    }

    let scheduleConflicts = 0;

    for (const list of vehicleTrips.values()) {
      list.sort((a, b) => a.departure - b.departure);

      for (let i = 1; i < list.length; i++) {
        const previous = list[i - 1];
        const current = list[i];

        const readyAt = previous.departure +
          previous.runtime + CONFIG.turnaround;

        if (readyAt > current.departure) {
          scheduleConflicts++;
        }
      }
    }

    const fleetCount = new Set(trips.map(trip => trip.vehicle)).size;

    const serviceViolations = CONFIG.routes.reduce((total, route) => {
      return total + route.departures.filter(departure =>
        !trips.some(trip =>
          trip.route.id === route.id &&
          trip.departure === departure
        )
      ).length;
    }, 0);

    const availabilityViolations = trips.filter(trip =>
      scenario.unavailable.includes(trip.route.vehicle) &&
      trip.vehicle === trip.route.vehicle
    ).length;

    const hardViolations =
      scheduleConflicts + serviceViolations + availabilityViolations;

    return {
      trips,
      demand,
      passengers,
      boarded: boardedTotal,
      unmet,
      averageWait: passengers ? weightedWait / passengers : 0,
      capacityAlerts,
      onTimeTrips,
      tripCount: trips.length,
      onTimePercent: trips.length
        ? onTimeTrips / trips.length * 100
        : 0,
      fleetCount,
      utilization: fleetCount / CONFIG.fleetSize * 100,
      scheduleConflicts,
      serviceViolations,
      availabilityViolations,
      hardViolations,
      feasible: hardViolations === 0 &&
        trips.every(trip => trip.boarded <= trip.capacity)
    };
  }

  function getResults() {
    return {
      baseline: simulate(state.scenario, "baseline"),
      adjustment: simulate(state.scenario, "adjustment"),
      proposed: simulate(state.scenario, "full")
    };
  }

  function renderMetrics(result) {
    setText("ontime-value", result.onTimePercent.toFixed(1));
    setText("ontime-change",
      `${result.onTimeTrips}/${result.tripCount} trips on time`);

    setText("wait-value", result.averageWait.toFixed(1));
    setText("wait-change",
      `${result.boarded}/${result.passengers} boardings served`);

    setText("util-value", Math.round(result.utilization));
    setText("fleet-count",
      `${result.fleetCount} / ${CONFIG.fleetSize}`);

    const alerts = result.capacityAlerts +
      result.serviceViolations +
      result.availabilityViolations;

    setText("alert-value", alerts);
    setText("alert-caption",
      result.unmet > 0
        ? `${result.unmet} boardings remain unserved`
        : alerts > 0
          ? "Review service constraints"
          : "No detected service alerts");

    renderRouteTable(result);
  }

  function renderRouteTable(result) {
    const table = $("routes-table");
    if (!table) return;

    for (const row of table.querySelectorAll("[data-route-id]")) {
      const route = CONFIG.routes.find(
        item => item.id === row.dataset.routeId
      );

      if (!route) continue;
      const trips = result.trips.filter(
        trip => trip.route.id === route.id
      );

      const busiest = trips.reduce((best, trip) =>
        !best || trip.load > best.load ? trip : best,
      null);

      const load = busiest ? busiest.load : 0;
      const capacity = busiest ? busiest.capacity : route.capacity;
      const ratio = capacity ? load / capacity : 0;

      const loadValue = row.querySelector(".load-value");
      if (loadValue) {
        loadValue.innerHTML =
          `${load} <small>/ ${capacity}</small>`;
      }

      const bar = row.querySelector(".load-track i");
      if (bar) {
        bar.style.width = `${Math.min(100, ratio * 100)}%`;
        bar.classList.toggle("load-red", ratio >= 0.9);
      }

      const status = row.querySelector(".status-pill");
      if (status) {
        const unavailable = SCENARIOS[state.scenario]
          .unavailable.includes(route.vehicle);

        status.textContent = unavailable
          ? "Replacement active"
          : ratio >= 0.9
            ? "Near capacity"
            : busiest && busiest.runtime > route.runtime + 5
              ? "Delayed"
              : "On time";
      }

      const small = row.querySelector("td:first-child small");
      if (small) {
        small.textContent = busiest
          ? `${busiest.vehicle} · ${capacity} seats`
          : `${route.vehicle} · ${capacity} seats`;
      }

      const subtitle = row.querySelector(".table-sub");
      if (subtitle) {
        const supplementalCount = trips.filter(
          trip => trip.supplemental
        ).length;
        subtitle.textContent = trips.length
          ? `Next ${formatTime(trips[0].departure)}${supplementalCount
            ? ` · +${supplementalCount} supplemental`
            : ""}`
          : "No scheduled trip";
      }
    }
  }

  function renderDemandChart() {
    const demand = getDemand(state.scenario);

    const totals = Array.from({ length: 8 }, (_, index) =>
      Object.values(demand).reduce(
        (sum, windows) => sum + windows[index], 0
      )
    );

    const columns = document.querySelectorAll(".bar-column");
    const visibleCount = state.showFourWindows ? 4 : 8;
    const maxValue = Math.max(1, ...totals);

    columns.forEach((column, index) => {
      const value = totals[index] || 0;
      const bar = column.querySelector("i");
      const label = column.querySelector(".bar-value");

      if (bar) {
        bar.style.height = `${value / maxValue * 100}%`;
      }

      if (label) label.textContent = value;
      column.hidden = index >= visibleCount;
    });

    setText("demand-total",
      totals.slice(0, visibleCount).reduce((sum, value) => sum + value, 0));
  }

  function renderComparison(results) {
    const baseline = results.baseline;
    const active = results[state.activePlan];

    const waitDifference = baseline.averageWait - active.averageWait;
    const onTimeDifference = active.onTimePercent - baseline.onTimePercent;

    const wait = $("compare-wait");
    if (wait) {
      wait.textContent =
        `${waitDifference >= 0 ? "−" : "+"}${Math.abs(
          waitDifference
        ).toFixed(1)} min`;
    }

    const onTime = $("compare-ontime");
    if (onTime) {
      onTime.textContent =
        `${onTimeDifference >= 0 ? "+" : "−"}${Math.abs(
          onTimeDifference
        ).toFixed(1)} pts`;
    }

    const capacity = $("compare-capacity");
    if (capacity) {
      capacity.textContent =
        `${active.hardViolations} hard-constraint violations`;
    }

    setText("compare-unmet",
      `${baseline.unmet} → ${active.unmet}`);
  }

  function getPeakRouteLoad(result, route) {
    const busiest = result.trips
      .filter(trip => trip.route.id === route.id)
      .reduce((best, trip) =>
        !best || trip.load > best.load ? trip : best,
      null);

    return busiest
      ? { load: busiest.load, capacity: busiest.capacity }
      : { load: 0, capacity: route.capacity };
  }

  function renderRecommendations(results) {
    const { baseline, adjustment, proposed } = results;
    const proposedLoadSummary = $("proposed-load-summary");
    if (proposedLoadSummary) {
      const actual = results[state.activePlan];
      const changedLoads = CONFIG.routes.flatMap(route => {
        const currentLoad = getPeakRouteLoad(actual, route);
        const proposedLoad = getPeakRouteLoad(proposed, route);

        return currentLoad.load !== proposedLoad.load ||
          currentLoad.capacity !== proposedLoad.capacity
          ? [`Route ${route.id} ${proposedLoad.load} / ${proposedLoad.capacity}`]
          : [];
      });

      proposedLoadSummary.hidden =
        !state.optimizationCalculated || changedLoads.length === 0;
      proposedLoadSummary.textContent = state.optimizationCalculated &&
        changedLoads.length
        ? `Proposed peak loads (not applied): ${changedLoads.join(" · ")}.`
        : "";
    }

    const optimize = $("optimize-button");
    if (optimize) {
      optimize.textContent = state.optimizationCalculated
        ? "✓ Plan optimized"
        : "Optimize plan";
    }

    const cards = document.querySelectorAll(".recommendation-card");
    const firstCard = cards[0];

    if (firstCard) {
      const title = firstCard.querySelector("h3");
      const paragraph = firstCard.querySelector("p");
      const impact = firstCard.querySelector(".impact-tag");
      const check = firstCard.querySelector(".feasible-check");
      const button = $("apply-recommendation");

      if (title) {
        title.textContent = state.scenario === "offline"
          ? "Reassign the unavailable bus"
          : "Add a Route B departure";
      }
      if (paragraph) {
        paragraph.textContent = state.scenario === "offline"
          ? "Use spare Bus 15 to replace Bus 09. The proposed schedule is checked against vehicle availability and turnaround constraints."
          : "Add a Route B departure at 08:30 using spare Bus 15. Results are calculated from synthetic demand.";
      }

      if (impact) {
        impact.textContent =
          adjustment.averageWait < baseline.averageWait &&
          adjustment.unmet < baseline.unmet
            ? "HIGH IMPACT"
            : "REVIEW IMPACT";
      }

      if (check) {
        check.textContent = adjustment.feasible
          ? "✓ No detected schedule or service violations"
          : `! ${adjustment.hardViolations} schedule/service violations detected`;
      }

      if (button) {
        button.disabled = state.adjustmentApplied;
        button.textContent = state.adjustmentApplied
          ? "✓ Adjustment applied"
          : "Apply adjustment →";
      }
    }

    const secondCard = cards[1];
    if (secondCard) {
      const paragraph = secondCard.querySelector("p");
      if (paragraph) {
        paragraph.textContent =
          "Protect the Library transfer by checking Route A's estimated arrival against Route C's scheduled departure. Any hold must remain within the connection's available slack.";
      }

      const button = $("apply-connection");
      if (button) {
        button.disabled = state.fullPlanApplied;
        button.textContent = state.fullPlanApplied
          ? "✓ Full plan applied"
          : "Apply full plan →";
      }
    }

    renderComparison(results);
  }

  function refresh() {
    const results = getResults();

    renderMetrics(results[state.activePlan]);
    renderDemandChart();
    renderRecommendations(results);
  }

  function optimizePlan() {
    const results = getResults();

    state.optimizationCalculated = true;
    refresh();

    if (!results.proposed.feasible) {
      showToast(
        `Optimized plan has ${results.proposed.hardViolations} detected schedule/service violations. Review before applying.`
      );
      return;
    }

    showToast(
      "Optimization calculated. Actual route loads, schedules, and dashboard metrics are unchanged."
    );
  }

  function applyAdjustment() {
    const results = getResults();

    if (!results.adjustment.feasible) {
      showToast(
        `Adjustment has ${results.adjustment.hardViolations} detected schedule/service violations. Review before applying.`
      );
      return;
    }

    state.adjustmentApplied = true;
    state.fullPlanApplied = false;
    state.activePlan = "adjustment";
    refresh();

    showToast("Adjustment applied. Dashboard shows the adjusted schedule.");
  }

  function applyFullPlan() {
    const results = getResults();

    if (!results.proposed.feasible) {
      showToast(
        `Full plan has ${results.proposed.hardViolations} detected schedule/service violations. Review before applying.`
      );
      return;
    }

    state.fullPlanApplied = true;
    state.adjustmentApplied = false;
    state.activePlan = "proposed";
    refresh();

    showToast("Full optimized plan applied. Dashboard shows the full schedule.");
  }

  function exportCSV() {
    const results = getResults();
    const rows = [[
      "scenario", "plan", "route", "vehicle", "scheduled_departure",
      "capacity", "boarded", "runtime_minutes", "supplemental"
    ]];

    for (const [planName, result] of [
      ["baseline", results.baseline],
      ["proposed", results.proposed]
    ]) {
      for (const trip of result.trips) {
        rows.push([
          SCENARIOS[state.scenario].name,
          planName,
          trip.route.id,
          trip.vehicle,
          formatTime(trip.departure),
          trip.capacity,
          trip.boarded,
          trip.runtime,
          trip.supplemental ? "yes" : "no"
        ]);
      }
    }

    const csv = rows.map(row =>
      row.map(value =>
        `"${String(value).replace(/"/g, '""')}"`
      ).join(",")
    ).join("\r\n");

    const blob = new Blob(["\uFEFF" + csv], {
      type: "text/csv;charset=utf-8"
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `routepulse-${state.scenario}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);

    showToast("Simulation CSV exported.");
  }

  function showToast(message) {
    let toast = $("toast");

    if (!toast) {
      toast = document.createElement("div");
      toast.id = "toast";
      toast.setAttribute("role", "status");
      Object.assign(toast.style, {
        position: "fixed",
        right: "20px",
        bottom: "20px",
        zIndex: "9999",
        maxWidth: "360px",
        padding: "14px 18px",
        borderRadius: "10px",
        background: "#102a43",
        color: "#ffffff",
        boxShadow: "0 8px 24px #0003"
      });
      document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.hidden = false;
    toast.classList.add("visible");
  }

  function openMethodology() {
    const method = $("method");
    if (!method) return;

    method.open = true;
    method.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function setupEvents() {
    const scenarioSelect = $("scenario-select");
    if (scenarioSelect) {
      scenarioSelect.addEventListener("change", event => {
        const selected = event.target.value;

        state.scenario = SCENARIOS[selected] ? selected : "normal";
        state.optimizationCalculated = false;
        state.adjustmentApplied = false;
        state.fullPlanApplied = false;
        state.activePlan = "baseline";

        refresh();
        showToast(`${SCENARIOS[state.scenario].name} loaded.`);
      });
    }

    const optimize = $("optimize-button");
    if (optimize) optimize.addEventListener("click", optimizePlan);

    const adjustment = $("apply-recommendation");
    if (adjustment) adjustment.addEventListener("click", applyAdjustment);

    const fullPlan = $("apply-connection");
    if (fullPlan) fullPlan.addEventListener("click", applyFullPlan);

    const exportButton = $("export-run");
    if (exportButton) exportButton.addEventListener("click", exportCSV);

    const comparisonDetails = $("comparison-details");
    if (comparisonDetails) {
      comparisonDetails.addEventListener("click", openMethodology);
    }

    const routeSchedule = $("routes-more-button");
    if (routeSchedule) {
      routeSchedule.addEventListener("click", openMethodology);
    }

    const viewAllRoutes = $("view-all-routes");
    if (viewAllRoutes) {
      viewAllRoutes.addEventListener("click", openMethodology);
    }

    const periodButton = $("chart-period-button");
    if (periodButton) {
      periodButton.addEventListener("click", () => {
        state.showFourWindows = !state.showFourWindows;
        periodButton.textContent = state.showFourWindows
          ? "Next 1 hour"
          : "Next 2 hours";
        renderDemandChart();
      });
    }

    const zoomIn = $("map-zoom-in");
    if (zoomIn) zoomIn.addEventListener("click", () => zoomMap(0.1));

    const zoomOut = $("map-zoom-out");
    if (zoomOut) zoomOut.addEventListener("click", () => zoomMap(-0.1));

    const mapMenu = $("map-menu");
    if (mapMenu) {
      mapMenu.addEventListener("click", () => {
        state.showLabels = !state.showLabels;

        document.querySelectorAll(".campus-label").forEach(label => {
          label.hidden = !state.showLabels;
        });
      });
    }

    const allArrivals = $("all-arrivals-button");
    if (allArrivals) {
      allArrivals.addEventListener("click", () => {
        $("routes")?.scrollIntoView({ behavior: "smooth" });
      });
    }

    const focusMap = $("map-focus-button");
    if (focusMap) {
      focusMap.addEventListener("click", () => {
        document.querySelector(".map-canvas")?.scrollIntoView({
          behavior: "smooth",
          block: "center"
        });
        showToast("Map positions are simulated, not live GPS.");
      });
    }

    const notifications = $("notification-button");
    if (notifications) {
      notifications.addEventListener("click", () => {
        showToast("Choose a scenario to test network disruptions.");
      });
    }

    document.querySelectorAll(".vehicle-marker").forEach(marker => {
      marker.addEventListener("click", () => {
        showToast(
          `${marker.getAttribute("aria-label") || "Vehicle"} - simulated position.`
        );
      });
    });
  }

  function zoomMap(amount) {
    state.zoom = Math.max(0.8, Math.min(1.4, state.zoom + amount));

    document.querySelectorAll(".route-map").forEach(map => {
      map.style.transform = `scale(${state.zoom})`;
      map.style.transformOrigin = "center";
    });
  }

  function init() {
    setupEvents();
    refresh();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();