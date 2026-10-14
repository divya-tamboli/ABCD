(() => {
    "use strict";

    const simulation = {
        constraints: { serviceStart: 8 * 60, serviceEnd: 10 * 60, minTurnaround: 5, transferSlack: 5 },
        stops: ["North Gate", "Library", "Science Quad", "Student Center", "West Residence", "Athletics"],
        routes: [
            { id: "A", vehicle: "Bus 04", capacity: 40, stops: ["North Gate", "Library", "Student Center"], departures: [495, 525, 555, 585] },
            { id: "B", vehicle: "Bus 09", capacity: 32, stops: ["West Residence", "Science Quad", "Student Center"], departures: [500, 530, 560, 590] },
            { id: "C", vehicle: "Bus 12", capacity: 40, stops: ["Library", "Athletics", "West Residence"], departures: [510, 540, 570] },
            { id: "D", vehicle: "Bus 07", capacity: 32, stops: ["North Gate", "Science Quad", "Athletics"], departures: [515, 545, 575] },
            { id: "E", vehicle: "Bus 02", capacity: 40, stops: ["Library", "West Residence"], departures: [520, 550, 580] },
            { id: "F", vehicle: "Bus 06", capacity: 40, stops: ["Student Center", "Athletics"], departures: [530, 560, 590] }
        ],
        spareVehicle: { id: "Bus 15", capacity: 40, available: true, availableFrom: 8 * 60 },
        demandByStop: {
            "North Gate": [5, 7, 10, 8, 5, 3, 2, 1],
            Library: [6, 8, 12, 10, 7, 4, 2, 1],
            "Science Quad": [7, 11, 17, 13, 9, 5, 2, 1],
            "Student Center": [8, 10, 15, 12, 8, 4, 2, 1],
            "West Residence": [5, 8, 11, 8, 6, 3, 2, 2],
            Athletics: [3, 4, 6, 4, 4, 2, 1, 1]
        },
        stopOffsetMinutes: { A: [0, 13, 16], B: [0, 5, 10], C: [0, 6, 12], D: [0, 5, 10], E: [0, 8], F: [0, 7] },
        scheduledRuntimeMinutes: { A: 18, B: 12, C: 14, D: 12, E: 10, F: 9 },
        gpsTripTraces: {
            A: [17, 18, 19, 18, 17], B: [11, 12, 13, 12, 12],
            C: [13, 14, 15, 14, 13], D: [11, 12, 13, 12, 11],
            E: [9, 10, 11, 10, 9], F: [8, 9, 10, 9, 8]
        },
        gpsRemainingMinutes: {
            A: [3, 4, 5, 4, 3],
            B: [6, 7, 8, 7, 6],
            C: [9, 10, 11, 10, 9]
        },
        etaValidation: [
            { predicted: 4, actual: 3 }, { predicted: 6, actual: 8 },
            { predicted: 8, actual: 5 }, { predicted: 6, actual: 8 },
            { predicted: 4, actual: 3 }, { predicted: 8, actual: 6 },
            { predicted: 11, actual: 14 }, { predicted: 4, actual: 3 },
            { predicted: 6, actual: 8 }, { predicted: 12, actual: 8 }
        ],
        connection: {
            fromRoute: "A", toRoute: "C", stop: "Library", riders: 8,
            arrivalOffsetMinutes: 13, scheduledDeparture: 8 * 60 + 30,
            slackMinutes: 5, holdMinutes: 3
        }
    };

    const scenarios = {
        normal: { demandMultiplier: 1, delays: { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0 }, unavailableVehicles: [] },
        traffic: { demandMultiplier: 1, delays: { A: 5, B: 12, C: 0, D: 5, E: 4, F: 4 }, unavailableVehicles: [] },
        surge: { demandMultiplier: 1.35, delays: { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0 }, unavailableVehicles: [] },
        offline: { demandMultiplier: 1, delays: { A: 0, B: 5, C: 0, D: 0, E: 0, F: 0 }, unavailableVehicles: ["Bus 09"] },
        campusEvent: {
            demandMultiplier: 1, delays: { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0 },
            unavailableVehicles: [], eventDemand: { stop: "Science Quad", windowIndex: 2, extraRiders: 24 }
        }
    };

    const baselineDemand = Array.from({ length: 8 }, (_, windowIndex) =>
        Object.values(simulation.demandByStop).reduce((sum, counts) => sum + counts[windowIndex], 0)
    );
    const baseEtaMae = simulation.etaValidation.reduce((sum, sample) =>
        sum + Math.abs(sample.predicted - sample.actual), 0) / simulation.etaValidation.length;
    const byId = (id) => document.getElementById(id);
    const scenarioSelect = byId("scenario-select");
    const toast = byId("toast");
    let activeScenario = "normal";
    let optimized = false;
    let connectionApplied = false;
    let visibleDemandWindows = 8;
    let mapZoom = 1;
    let stopLabelsVisible = true;
    let toastTimer;

    function showToast(message) {
        toast.textContent = message;
        toast.classList.add("visible");
        window.clearTimeout(toastTimer);
        toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 3800);
    }

    function median(values) {
        const sorted = [...values].sort((a, b) => a - b);
        const middle = Math.floor(sorted.length / 2);
        return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
    }

    function getEtaWindow(routeId, delay) {
        const estimate = median(simulation.gpsRemainingMinutes[routeId]) + delay;
        return `${Math.max(0, Math.floor(estimate - 1))}–${Math.ceil(estimate + 1)}`;
    }

    function formatTime(minutes) {
        const hour = Math.floor(minutes / 60);
        const minute = Math.round(minutes % 60).toString().padStart(2, "0");
        return `${hour.toString().padStart(2, "0")}:${minute}`;
    }

    function getStopDemandForecast(scenarioKey = activeScenario) {
        const disruption = scenarios[scenarioKey];
        return Object.fromEntries(Object.entries(simulation.demandByStop).map(([stop, values]) => [
            stop,
            values.map((count, windowIndex) =>
                Math.round(count * disruption.demandMultiplier) +
                (disruption.eventDemand?.stop === stop && disruption.eventDemand.windowIndex === windowIndex ?
                    disruption.eventDemand.extraRiders : 0))
        ]));
    }

    function getDemandForecast(scenarioKey = activeScenario) {
        const stopForecast = getStopDemandForecast(scenarioKey);
        const counts = baselineDemand.map((_, windowIndex) =>
            Object.values(stopForecast).reduce((sum, stopCounts) => sum + stopCounts[windowIndex], 0));
        const disruption = scenarios[scenarioKey];
        const firstA = simulation.routes.find((route) => route.id === simulation.connection.fromRoute);
        const departure = firstA.departures.find((time) => time === 8 * 60 + 15);
        const runtime = simulation.gpsTripTraces.A[0] + disruption.delays.A;
        const arrival = departure + simulation.connection.arrivalOffsetMinutes *
            runtime / simulation.scheduledRuntimeMinutes.A;
        const transferWindow = Math.floor((arrival - simulation.constraints.serviceStart) / 15);
        if (transferWindow >= 0 && transferWindow < counts.length) {
            counts[transferWindow] += Math.round(simulation.connection.riders * disruption.demandMultiplier);
        }
        return counts;
    }

    function buildPlan(key, proposed) {
        const disruption = scenarios[key];
        const trips = [];
        simulation.routes.forEach((route) => {
            const unavailable = disruption.unavailableVehicles.includes(route.vehicle);
            if (unavailable && !(proposed && key === "offline" && route.id === "B")) return;
            route.departures.forEach((departure, index) => {
                const vehicle = unavailable ? simulation.spareVehicle.id : route.vehicle;
                const capacity = unavailable ? simulation.spareVehicle.capacity : route.capacity;
                trips.push({ route, departure, vehicle, capacity, traceIndex: index, supplemental: false });
            });
        });
        if (proposed && key !== "offline") {
            const route = simulation.routes.find((item) => item.id === "B");
            [8 * 60 + 30, 9 * 60].forEach((departure, index) => {
                trips.push({
                    route,
                    departure,
                    vehicle: simulation.spareVehicle.id,
                    capacity: simulation.spareVehicle.capacity,
                    traceIndex: index,
                    supplemental: true
                });
            });
        }
        return trips.sort((a, b) => a.departure - b.departure || a.route.id.localeCompare(b.route.id));
    }

    function simulateScenario(key, proposed, includeConnectionHold) {
        const disruption = scenarios[key];
        const trips = buildPlan(key, proposed);
        const forecast = getStopDemandForecast(key);
        const queues = new Map();
        Object.entries(forecast).forEach(([stop, counts]) => {
            if (!queues.has(stop)) queues.set(stop, []);
            counts.forEach((count, index) => {
                if (count === 0) return;
                queues.get(stop).push({
                    stop,
                    arrival: simulation.constraints.serviceStart + index * 15 + 7.5,
                    count
                });
            });
            queues.get(stop).sort((a, b) => a.arrival - b.arrival);
        });

        const firstA = simulation.routes.find((route) => route.id === "A");
        const connectionQueueKey = simulation.connection.stop;
        if (!queues.has(connectionQueueKey)) queues.set(connectionQueueKey, []);
        const firstADeparture = firstA.departures.find((departure) => departure === 8 * 60 + 15);
        const firstARuntime = simulation.gpsTripTraces.A[0] + disruption.delays.A;
        const arrivalAAtLibrary = firstADeparture + simulation.connection.arrivalOffsetMinutes *
            firstARuntime / simulation.scheduledRuntimeMinutes.A;
        const departureCFromLibrary = simulation.connection.scheduledDeparture + disruption.delays.C;
        const holdRequired = Math.max(0, arrivalAAtLibrary - departureCFromLibrary);
        const connectionHeld = Boolean(includeConnectionHold && holdRequired > 0 &&
            holdRequired <= simulation.connection.holdMinutes &&
            holdRequired <= simulation.connection.slackMinutes);
        const transferRiders = Math.round(simulation.connection.riders * disruption.demandMultiplier);
        const connectionMissed = holdRequired > 0 && !connectionHeld ? transferRiders : 0;
        const transferQueue = queues.get(connectionQueueKey);
        transferQueue.push({
            arrival: arrivalAAtLibrary,
            count: transferRiders
        });
        transferQueue.sort((a, b) => a.arrival - b.arrival);

        const serviceEvents = [];
        trips.forEach((trip) => {
            const trace = simulation.gpsTripTraces[trip.route.id];
            const runtime = trace[trip.traceIndex % trace.length] + disruption.delays[trip.route.id];
            const delayRatio = runtime / simulation.scheduledRuntimeMinutes[trip.route.id];
            trip.runtime = runtime;
            trip.hold = connectionHeld && trip.route.id === "C" && trip.departure === 8 * 60 + 30 ?
                Math.min(simulation.connection.holdMinutes, holdRequired) : 0;
            trip.operationalDeparture = trip.departure + trip.hold;
            trip.onTime = runtime + trip.hold <= simulation.scheduledRuntimeMinutes[trip.route.id] + 5;
            trip.load = 0;
            trip.boarded = 0;
            trip.route.stops.forEach((stop, stopIndex) => {
                const offset = simulation.stopOffsetMinutes[trip.route.id][stopIndex];
                const eventTime = trip.operationalDeparture + offset * delayRatio;
                serviceEvents.push({ trip, stop, stopIndex, eventTime });
            });
        });

        serviceEvents.sort((a, b) => a.eventTime - b.eventTime || a.stopIndex - b.stopIndex);
        const stats = {
            passengers: Object.values(forecast).flat().reduce((sum, count) => sum + count, 0) +
                Math.round(simulation.connection.riders * disruption.demandMultiplier),
            served: 0, unmet: 0, waitTotal: 0, capacityAlerts: 0,
            peakRouteBLoad: 0, peakRouteBVehicleCapacity: simulation.routes[1].capacity,
            maxLoadRatio: 0, onTimeTrips: 0, trips: trips.length,
            scheduleConflicts: [], fleetCount: new Set(trips.map((trip) => trip.vehicle)).size,
            missedConnections: connectionMissed,
            connectionHeld,
            connectionHold: connectionHeld ? Math.min(simulation.connection.holdMinutes, holdRequired) : 0,
            connectionReadyAt: arrivalAAtLibrary,
            connectionDeparture: departureCFromLibrary
        };

        serviceEvents.forEach(({ trip, stop, eventTime }) => {
            const queue = queues.get(stop);
            if (!queue) return;
            let pendingCount = 0;
            while (pendingCount < queue.length && queue[pendingCount].arrival <= eventTime) pendingCount += 1;
            let pending = queue.splice(0, pendingCount);
            let seats = trip.capacity - trip.load;
            let leftWaiting = 0;
            const waitingGroups = [];
            pending.forEach((group) => {
                const boarded = Math.min(group.count, Math.max(0, seats));
                stats.served += boarded;
                trip.boarded += boarded;
                trip.load += boarded;
                seats -= boarded;
                stats.waitTotal += boarded * Math.max(0, eventTime - group.arrival);
                if (boarded < group.count) {
                    const remainder = { ...group, count: group.count - boarded };
                    waitingGroups.push(remainder);
                    leftWaiting += remainder.count;
                }
            });
            if (leftWaiting > 0) stats.capacityAlerts += 1;
            queues.set(stop, [...waitingGroups, ...queue].sort((a, b) => a.arrival - b.arrival));
            if (trip.route.id === "B") {
                stats.peakRouteBLoad = Math.max(stats.peakRouteBLoad, trip.load);
                stats.peakRouteBVehicleCapacity = trip.capacity;
                stats.maxLoadRatio = Math.max(stats.maxLoadRatio, trip.load / trip.capacity);
            }
        });

        queues.forEach((queue) => queue.forEach((group) => {
            stats.unmet += group.count;
            stats.waitTotal += group.count * Math.max(0, simulation.constraints.serviceEnd - group.arrival);
        }));
        stats.wait = stats.passengers ? stats.waitTotal / stats.passengers : 0;
        stats.onTimeTrips = trips.filter((trip) => trip.onTime).length;
        stats.onTimePercent = trips.length ? stats.onTimeTrips / trips.length * 100 : 0;

        const byVehicle = new Map();
        trips.forEach((trip) => {
            if (!byVehicle.has(trip.vehicle)) byVehicle.set(trip.vehicle, []);
            byVehicle.get(trip.vehicle).push(trip);
        });
        byVehicle.forEach((vehicleTrips, vehicle) => {
            vehicleTrips.sort((a, b) => a.departure - b.departure);
            for (let index = 1; index < vehicleTrips.length; index += 1) {
                const previous = vehicleTrips[index - 1];
                const current = vehicleTrips[index];
                const readyAt = previous.operationalDeparture + previous.runtime + simulation.constraints.minTurnaround;
                if (readyAt > current.departure) {
                    stats.scheduleConflicts.push({ vehicle, readyAt, nextDeparture: current.departure });
                }
            }
        });
        stats.capacityViolations = trips.filter((trip) => trip.load > trip.capacity).length;
        stats.serviceViolations = simulation.routes.reduce((missing, route) => {
            const missingDepartures = route.departures.filter((departure) =>
                departure >= simulation.constraints.serviceStart && departure < simulation.constraints.serviceEnd &&
                !trips.some((trip) => trip.route.id === route.id && trip.departure === departure));
            return missing + missingDepartures.length;
        }, 0);
        stats.vehicleAvailabilityViolations = trips.filter((trip) =>
            (trip.vehicle === simulation.spareVehicle.id && trip.departure < simulation.spareVehicle.availableFrom) ||
            (disruption.unavailableVehicles.includes(trip.route.vehicle) && trip.vehicle === trip.route.vehicle)).length;
        stats.feasible = stats.capacityViolations === 0 && stats.scheduleConflicts.length === 0 &&
            stats.serviceViolations === 0 && stats.vehicleAvailabilityViolations === 0 &&
            trips.every((trip) => trip.departure >= simulation.constraints.serviceStart &&
                trip.departure < simulation.constraints.serviceEnd) &&
            trips.every((trip) => trip.boarded <= trip.capacity);
        stats.utilization = stats.fleetCount / 15 * 100;
        stats.forecast = forecast;
        stats.tripsByRoute = trips;
        return stats;
    }

    function checkPlan(key) {
        const baseline = simulateScenario(key, false, false);
        const proposed = simulateScenario(key, true, true);
        const holdFitsSlack = simulation.connection.holdMinutes <= simulation.constraints.transferSlack;
        return {
            feasible: proposed.feasible && simulation.spareVehicle.available && holdFitsSlack,
            available: simulation.spareVehicle.available,
            inWindow: proposed.tripsByRoute.every((trip) =>
                trip.departure >= simulation.constraints.serviceStart && trip.departure < simulation.constraints.serviceEnd),
            capacity: proposed.capacityViolations === 0,
            holdFitsSlack,
            baseline,
            proposed
        };
    }

    function updateDemandChart() {
        const counts = getDemandForecast(activeScenario);
        const maximum = Math.ceil(Math.max(...counts) / 20) * 20;
        document.querySelectorAll(".chart-y-axis span").forEach((label, index) => {
            label.textContent = String(Math.round(maximum * (4 - index) / 4));
        });
        document.querySelector(".chart-bars").classList.toggle("hour-window", visibleDemandWindows === 4);
        const columns = document.querySelectorAll(".bar-column");
        columns.forEach((column, index) => {
            const count = counts[index];
            column.querySelector(".bar-value").textContent = String(count);
            column.querySelector("i").style.height = `${Math.min(100, Math.round(count / maximum * 100))}%`;
            column.hidden = index >= visibleDemandWindows;
            column.classList.toggle("peak-bar", count === Math.max(...counts));
        });
        const visibleTotal = counts.slice(0, visibleDemandWindows).reduce((sum, count) => sum + count, 0);
        byId("demand-total").textContent = String(visibleTotal);
        byId("demand-chart").setAttribute("aria-label",
            `Forecast of ${visibleTotal} campus passenger boardings, peaking at ${Math.max(...counts.slice(0, visibleDemandWindows))} in a 15-minute window`);
    }

    function updateComparison(state) {
        const waitChange = state.baseline.wait > 0 ?
            Math.round((1 - state.proposed.wait / state.baseline.wait) * 100) : 0;
        const onTimeChange = state.proposed.onTimePercent - state.baseline.onTimePercent;
        const waitPrefix = waitChange > 0 ? "−" : waitChange < 0 ? "+" : "";
        const onTimePrefix = onTimeChange > 0 ? "+" : onTimeChange < 0 ? "−" : "";
        byId("compare-wait").innerHTML = `${waitPrefix}${Math.abs(waitChange)}<span>%</span>`;
        byId("compare-ontime").innerHTML = `${onTimePrefix}${Math.abs(onTimeChange).toFixed(1)}<span> pts</span>`;
        byId("compare-capacity").innerHTML = state.proposed.feasible ?
            "0<span> hard</span>" :
            `${state.proposed.capacityViolations + state.proposed.scheduleConflicts.length + state.proposed.serviceViolations + state.proposed.vehicleAvailabilityViolations}<span> violations</span>`;
        byId("compare-unmet").textContent = `${state.baseline.unmet} → ${state.proposed.unmet}`;
        return state;
    }

    function renderMetrics(result, disruption, isProposed) {
        byId("ontime-value").textContent = result.onTimePercent.toFixed(1);
        byId("wait-value").textContent = result.wait.toFixed(1);
        byId("util-value").textContent = result.utilization.toFixed(0);
        byId("fleet-count").textContent = `${result.fleetCount} / 15 vehicles`;
        byId("ontime-change").textContent = `${result.onTimeTrips}/${result.trips} trips on time`;
        byId("wait-change").textContent = `${result.served}/${result.passengers} boardings served`;
        const missedConnectionAlerts = result.missedConnections > 0 ? 1 : 0;
        byId("alert-value").textContent = String(result.capacityAlerts + missedConnectionAlerts +
            result.serviceViolations + result.vehicleAvailabilityViolations);
        byId("alert-caption").textContent = [
            result.unmet ? `${result.unmet} boardings unserved` : "",
            result.missedConnections ? `${result.missedConnections} missed-connection riders` : "",
            result.serviceViolations ? `${result.serviceViolations} trips uncovered` : ""
        ].filter(Boolean).join(" · ") || (result.capacityAlerts ? "Capacity pressure" : "No service alerts");

        document.querySelectorAll("#routes-table [data-route-id]").forEach((row) => {
            const routeId = row.getAttribute("data-route-id");
            const route = simulation.routes.find((item) => item.id === routeId);
            const routeTrips = result.tripsByRoute.filter((trip) => trip.route.id === routeId);
            const peakTrip = routeTrips.reduce((peak, trip) => !peak || trip.load > peak.load ? trip : peak, null);
            const peakLoad = peakTrip ? peakTrip.load : 0;
            const capacity = peakTrip ? peakTrip.capacity : route.capacity;
            const loadRatio = peakLoad / capacity;
            const unavailable = disruption.unavailableVehicles.includes(route.vehicle) && !peakTrip;
            const vehicle = peakTrip ? peakTrip.vehicle : route.vehicle;
            row.querySelector("td:first-child small").textContent = unavailable ?
                `${route.vehicle} · unavailable` : `${vehicle} · ${capacity} seats`;
            row.querySelector(".load-value").innerHTML = `${peakLoad} <small>/ ${capacity}</small>`;
            const bar = row.querySelector(".load-track i");
            bar.style.width = `${Math.min(100, Math.round(loadRatio * 100))}%`;
            bar.className = loadRatio >= 0.9 ? "load-red" :
                ({ A: "load-green", B: "load-purple", C: "load-blue", D: "load-purple", E: "load-green", F: "load-blue" }[routeId]);
            const status = row.querySelector(".status-pill");
            const delayed = peakTrip && !peakTrip.onTime;
            status.textContent = unavailable ? "Bus unavailable" :
                (isProposed && routeId === "B" ? (activeScenario === "offline" ? "Bus 15 replacement" : "Extra departures") :
                    (delayed ? "Delayed" : loadRatio >= 0.9 ? "Near capacity" : "On time"));
            status.className = `status-pill ${unavailable || delayed ? "status-delay" :
                loadRatio >= 0.9 ? "status-crowded" : "status-on-time"}`;
        });
    }

    function updateRouteEtaCells(disruption) {
        document.querySelectorAll("#routes-table [data-route-id]").forEach((row) => {
            const routeId = row.getAttribute("data-route-id");
            const route = simulation.routes.find((item) => item.id === routeId);
            const departure = route.departures[0];
            const trace = simulation.gpsTripTraces[routeId];
            const earliestArrival = departure + Math.min(...trace) + disruption.delays[routeId];
            const latestArrival = departure + Math.max(...trace) + disruption.delays[routeId];
            const eta = row.querySelector(".table-sub");
            eta.textContent = `ETA ${formatTime(Math.floor(earliestArrival))}–${formatTime(Math.ceil(latestArrival))}`;
        });
    }

    function updateEtas(disruption) {
        ["A", "B", "C"].forEach((routeId) => {
            const element = byId(`arrival-${routeId.toLowerCase()}-time`);
            if (element) element.innerHTML = `${getEtaWindow(routeId, disruption.delays[routeId])} <small>min</small>`;
        });
        byId("eta-error-value").textContent = `${baseEtaMae.toFixed(1)} min MAE`;
    }

    function updateRecommendation(key) {
        const validation = checkPlan(key);
        const cards = byId("recommendation-grid").querySelectorAll(".recommendation-card");
        const metrics = cards[0].querySelectorAll(".rec-metrics strong");
        const baseline = validation.baseline;
        const proposed = validation.proposed;
        const spareTrips = proposed.tripsByRoute.filter((trip) => trip.vehicle === simulation.spareVehicle.id);
        const spareLoad = spareTrips.reduce((sum, trip) => sum + trip.boarded, 0);
        const spareCapacity = spareTrips.reduce((sum, trip) => sum + trip.capacity, 0);
        const waitImprovement = baseline.wait - proposed.wait;
        const onTimeChange = proposed.onTimePercent - baseline.onTimePercent;
        const overflowsCovered = Math.max(0, baseline.unmet - proposed.unmet);
        const recType = cards[0].querySelector(".rec-type");
        recType.innerHTML = key === "offline" ?
            "<span>↗</span> VEHICLE REASSIGNMENT" : "<span>↗</span> CAPACITY ALLOCATION";
        cards[0].querySelector("h3").textContent = key === "offline" ?
            "Replace the unavailable Route B vehicle" :
            "Add Route B departures at 08:30 and 09:00";
        const recommendationCopy = key === "offline" ?
            `Bus 15 replaces Bus 09 across the Route B timetable. ${spareLoad} riders board the replacement service; its 40-seat limit is checked against each trip and 5-minute turnaround.` :
            `The existing Bus 09 timetable stays intact. Spare Bus 15 adds 08:30 and 09:00 departures, boarding ${spareLoad} riders total; passenger wait and unmet demand are simulated from stop-level arrivals.`;
        const reliabilityChange = onTimeChange < 0 ?
            `on-time share falls ${Math.abs(onTimeChange).toFixed(1)} points because added/replacement trips inherit disruption delays` :
            onTimeChange > 0 ? `on-time share rises ${onTimeChange.toFixed(1)} points` : "on-time share is unchanged";
        const waitChangeCopy = waitImprovement >= 0 ?
            `mean wait falls ${waitImprovement.toFixed(1)} minutes` :
            `mean wait rises ${Math.abs(waitImprovement).toFixed(1)} minutes`;
        const reliabilityTradeoff = ` Trade-off: ${reliabilityChange}; ${waitChangeCopy}.`;
        cards[0].querySelector("p").textContent = recommendationCopy + reliabilityTradeoff;
        metrics[0].innerHTML = `${overflowsCovered} <small>unmet riders resolved</small>`;
        metrics[1].innerHTML = `${waitImprovement >= 0 ? "−" : "+"}${Math.abs(waitImprovement).toFixed(1)} <small>min mean wait</small>`;
        metrics[2].innerHTML = `${spareLoad} <small>/ ${spareCapacity} spare-bus seats</small>`;
        const impactTag = cards[0].querySelector(".impact-tag");
        const highImpact = waitImprovement > 0 && overflowsCovered > 0;
        impactTag.textContent = highImpact ? "HIGH IMPACT" :
            waitImprovement > 0 || overflowsCovered > 0 ? "MEDIUM IMPACT" : "NO IMPROVEMENT";
        impactTag.classList.toggle("impact-medium", !highImpact);
        const feasibilityLabel = cards[0].querySelector(".feasible-check");
        feasibilityLabel.textContent = validation.feasible ?
            `✓ ${proposed.capacityViolations} capacity · ${proposed.scheduleConflicts.length} schedule · ${proposed.serviceViolations} service · ${proposed.vehicleAvailabilityViolations} availability violations` :
            "! Plan infeasible — review constraints";
        feasibilityLabel.classList.toggle("infeasible-check", !validation.feasible);
        cards[1].querySelector("h3").textContent = "Protect the Library connection";
        cards[1].querySelector("p").textContent =
            `Route A arrives at Library at ${formatTime(proposed.connectionReadyAt)}; Route C is due at ${formatTime(proposed.connectionDeparture)}. ` +
            (proposed.connectionHeld ?
                `Hold ${proposed.connectionHold} minutes to save ${baseline.missedConnections} transfers, within ${simulation.connection.slackMinutes} minutes of slack.` :
                baseline.missedConnections ?
                    `${baseline.missedConnections} connecting riders miss the trip; a ${simulation.connection.holdMinutes}-minute hold cannot cover the full delay, so this plan does not claim to save them.` :
                    "No hold is needed; the scheduled connection is feasible.");
        cards[1].querySelectorAll(".rec-metrics strong")[0].innerHTML =
            `−${Math.max(0, baseline.missedConnections - proposed.missedConnections)} <small>missed transfers</small>`;
        cards[1].querySelectorAll(".rec-metrics strong")[1].innerHTML =
            `${proposed.connectionHold} <small>min hold</small>`;
        cards[1].querySelectorAll(".rec-metrics strong")[2].innerHTML =
            `${simulation.connection.slackMinutes - proposed.connectionHold} <small>min slack left</small>`;
        cards[1].querySelector(".feasible-check").textContent = validation.holdFitsSlack ?
            `✓ ${proposed.missedConnections} missed transfers in proposed plan` :
            "! Hold exceeds scheduled connection slack";
        cards[1].querySelector(".feasible-check").classList.toggle("infeasible-check", !validation.holdFitsSlack);
        const applyButton = byId("apply-recommendation");
        applyButton.disabled = !validation.feasible;
        applyButton.classList.remove("applied");
        applyButton.textContent = key === "offline" ? "Reassign vehicle →" : "Apply adjustment →";
        const connectionButton = byId("apply-connection");
        connectionButton.classList.remove("applied");
        connectionButton.disabled = !validation.holdFitsSlack;
        connectionButton.textContent = "Apply full plan →";
        return validation;
    }

    function setScenario(key) {
        if (!Object.prototype.hasOwnProperty.call(scenarios, key)) return;
        activeScenario = key;
        optimized = false;
        connectionApplied = false;
        const disruption = scenarios[key];
        const plan = updateRecommendation(key);
        renderMetrics(plan.baseline, disruption, false);
        updateEtas(disruption);
        updateDemandChart();
        updateRouteEtaCells(disruption);
        updateComparison(plan);
    }

    function applyPlan() {
        if (optimized) {
            showToast("The recommended adjustment is already included in this plan.");
            return;
        }
        const validation = checkPlan(activeScenario);
        if (!validation.feasible) {
            showToast("Plan not applied: vehicle availability, capacity, service window, or turnaround constraints are not satisfied.");
            return;
        }
        optimized = true;
        connectionApplied = true;
        renderMetrics(validation.proposed, scenarios[activeScenario], true);
        updateComparison(validation);
        const button = byId("apply-recommendation");
        button.classList.add("applied");
        button.textContent = "✓ Adjustment applied";
        button.disabled = true;
        byId("apply-connection").disabled = true;
        byId("apply-connection").classList.add("applied");
        byId("apply-connection").textContent = "✓ Connection checked";
        byId("optimize-button").textContent = "✓ Plan applied";
        byId("optimize-button").disabled = true;
        const change = validation.baseline.wait - validation.proposed.wait;
        showToast(`Simulated feasible plan applied. Mean wait ${validation.baseline.wait.toFixed(1)} → ${validation.proposed.wait.toFixed(1)} minutes (${change >= 0 ? "−" : "+"}${Math.abs(change).toFixed(1)}). ${validation.proposed.served}/${validation.proposed.passengers} boardings served.`);
    }

    function exportRunCSV() {
        if (typeof Blob === "undefined" || typeof URL.createObjectURL !== "function") {
            showToast("CSV export is not supported by this browser.");
            return;
        }
        const validation = checkPlan(activeScenario);
        const scenarioName = scenarioSelect.options[scenarioSelect.selectedIndex].textContent.trim();
        const headers = [
            "record_type", "scenario", "data_source", "evaluation_window", "plan",
            "feasible", "mean_wait_min", "on_time_percent", "total_demand",
            "boarded", "unmet", "capacity_alerts", "capacity_violations",
            "schedule_conflicts", "service_violations", "availability_violations",
            "hard_constraint_violations", "missed_connections", "route_id", "scheduled_departure",
            "operational_departure", "vehicle", "capacity", "trip_boarded",
            "trip_load", "trip_runtime_min", "trip_on_time", "supplemental"
        ];
        const csvEscape = (value) => `"${String(value).replace(/"/g, '""')}"`;
        const rows = [headers.map(csvEscape)];
        [
            { name: "baseline", stats: validation.baseline },
            { name: "proposed", stats: validation.proposed }
        ].forEach(({ name, stats }) => {
            const hardViolations = stats.capacityViolations + stats.scheduleConflicts.length +
                stats.serviceViolations + stats.vehicleAvailabilityViolations;
            rows.push([
                "summary", scenarioName, "Synthetic deterministic simulation", "08:00-10:00",
                name, stats.feasible && (name !== "proposed" || validation.feasible),
                stats.wait.toFixed(2), stats.onTimePercent.toFixed(2), stats.passengers,
                stats.served, stats.unmet, stats.capacityAlerts, stats.capacityViolations,
                stats.scheduleConflicts.length, stats.serviceViolations,
                stats.vehicleAvailabilityViolations, hardViolations, stats.missedConnections,
                "", "", "", "", "", "", "", "", "", ""
            ].map(csvEscape));
            stats.tripsByRoute.forEach((trip) => {
                rows.push([
                    "trip", scenarioName, "Synthetic deterministic simulation", "08:00-10:00",
                    name, stats.feasible && (name !== "proposed" || validation.feasible),
                    "", "", stats.passengers, "", "", "", stats.capacityViolations,
                    "", "", stats.vehicleAvailabilityViolations, hardViolations,
                    stats.missedConnections, trip.route.id,
                    formatTime(trip.departure), formatTime(trip.operationalDeparture),
                    trip.vehicle, trip.capacity, trip.boarded, trip.load, trip.runtime,
                    trip.onTime, trip.supplemental
                ].map(csvEscape));
            });
        });
        const blob = new Blob([rows.map((row) => row.join(",")).join("\r\n")], {
            type: "text/csv;charset=utf-8"
        });
        const downloadUrl = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = downloadUrl;
        link.download = `routepulse-${activeScenario}-simulation.csv`;
        link.style.display = "none";
        document.body.append(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
        showToast(`Exported baseline and proposed trip-level results for ${scenarioName}.`);
    }

    scenarioSelect.addEventListener("change", (event) => {
        setScenario(event.currentTarget.value);
        byId("optimize-button").disabled = false;
        byId("optimize-button").innerHTML = '<span class="sparkle">✳</span> Optimize plan <span class="button-shortcut">↗</span>';
        const names = {
            normal: "Normal operations loaded. Baseline comparison uses the fixed 8:00–10:00 AM window.",
            traffic: "Traffic disruption loaded: simulated segment travel times increase by 12 minutes.",
            surge: "Demand spike loaded: forecast passenger demand increases by 35%.",
            offline: "Vehicle disruption loaded: Bus 09 is unavailable; spare fleet capacity is checked.",
            campusEvent: "Campus event loaded: 24 reproducible synthetic riders are added at Science Quad in the 08:30 window."
        };
        showToast(names[activeScenario]);
    });

    byId("export-run").addEventListener("click", exportRunCSV);
    byId("optimize-button").addEventListener("click", applyPlan);
    byId("apply-recommendation").addEventListener("click", applyPlan);
    byId("apply-connection").addEventListener("click", () => {
        const validation = checkPlan(activeScenario);
        if (!validation.holdFitsSlack) {
            showToast("Connection hold rejected: it exceeds available scheduled slack.");
            return;
        }
        if (connectionApplied) {
            showToast("The connection adjustment is already applied.");
            return;
        }
        applyPlan();
    });

    byId("comparison-details").addEventListener("click", () => {
        const method = byId("method");
        method.open = true;
        method.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    byId("map-focus-button").addEventListener("click", () => {
        document.querySelector(".map-canvas").scrollIntoView({ behavior: "smooth", block: "center" });
        showToast("Route map shows simulated GPS positions and scheduled stop sequences.");
    });
    byId("all-arrivals-button").addEventListener("click", () => {
        byId("routes").scrollIntoView({ behavior: "smooth", block: "start" });
        showToast("All six route schedules are listed below; predicted ETAs use simulated GPS traces.");
    });

    byId("notification-button").addEventListener("click", () => {
        showToast("No live service alerts. Select a disruption scenario to test the network response.");
    });

    byId("map-menu").addEventListener("click", () => {
        stopLabelsVisible = !stopLabelsVisible;
        document.querySelectorAll(".campus-label").forEach((label) => {
            label.hidden = !stopLabelsVisible;
        });
        showToast(`Map stop labels ${stopLabelsVisible ? "shown" : "hidden"}. Routes remain visible.`);
    });

    const adjustMapZoom = (amount) => {
        mapZoom = Math.max(0.9, Math.min(1.4, mapZoom + amount));
        document.querySelectorAll(".route-map, .vehicle-marker, .campus-label").forEach((layer) => {
            layer.style.transform = `scale(${mapZoom})`;
            layer.style.transformOrigin = "center";
        });
    };
    byId("map-zoom-in").addEventListener("click", () => adjustMapZoom(0.1));
    byId("map-zoom-out").addEventListener("click", () => adjustMapZoom(-0.1));

    byId("chart-period-button").addEventListener("click", (event) => {
        visibleDemandWindows = visibleDemandWindows === 8 ? 4 : 8;
        const period = visibleDemandWindows === 8 ? "Next 2 hours" : "Next 1 hour";
        event.currentTarget.innerHTML = `${period} <span>⌄</span>`;
        event.currentTarget.setAttribute("aria-label", `Demand forecast: ${period}; click to change window`);
        updateDemandChart();
    });

    byId("routes-more-button").addEventListener("click", () => byId("view-all-routes").click());

    const extraRoutes = [
        '<tr data-route-id="E"><td><span class="table-route"><i class="route-dot route-dot-a"></i><span><strong>Route E</strong><small>Bus 02 · 40 seats</small></span></span></td><td><strong>08:40</strong><small class="table-sub">ETA 08:53–08:56</small></td><td><span class="load-value">19 <small>/ 40</small></span><span class="load-track"><i class="load-green" style="width:48%"></i></span></td><td><span class="status-pill status-on-time">On time</span></td></tr>',
        '<tr data-route-id="F"><td><span class="table-route"><i class="route-dot route-dot-c"></i><span><strong>Route F</strong><small>Bus 06 · 40 seats</small></span></span></td><td><strong>08:50</strong><small class="table-sub">ETA 09:04–09:06</small></td><td><span class="load-value">16 <small>/ 40</small></span><span class="load-track"><i class="load-blue" style="width:40%"></i></span></td><td><span class="status-pill status-on-time">On time</span></td></tr>'
    ];
    let routesExpanded = false;
    byId("view-all-routes").addEventListener("click", (event) => {
        const tbody = byId("routes-table");
        if (routesExpanded) {
            tbody.querySelectorAll(".extra-route").forEach((row) => row.remove());
            event.currentTarget.innerHTML = "View route schedule <span>↗</span>";
        } else {
            extraRoutes.forEach((markup) => {
                const row = document.createElement("template");
                row.innerHTML = markup;
                row.content.firstElementChild.classList.add("extra-route");
                tbody.append(row.content);
            });
            event.currentTarget.innerHTML = "Show fewer routes <span>↗</span>";
        }
        routesExpanded = !routesExpanded;
        byId("routes-more-button").setAttribute("aria-label",
            routesExpanded ? "Show fewer route schedules" : "Show all route schedules");
        const result = simulateScenario(activeScenario, optimized, optimized);
        renderMetrics(result, scenarios[activeScenario], optimized);
        updateRouteEtaCells(scenarios[activeScenario]);
        document.querySelector(".table-footer > span").innerHTML = `<span class="table-live-dot"></span> ${routesExpanded ? "6" : "4"} of 6 routes shown`;
    });

    document.querySelectorAll(".vehicle-marker").forEach((marker) => {
        marker.addEventListener("click", () => showToast(`${marker.getAttribute("aria-label")}. Position is simulated from the latest GPS trace.`));
    });

    document.querySelectorAll(".nav-item[href^='#']").forEach((item) => {
        item.addEventListener("click", () => {
            document.querySelectorAll(".nav-item").forEach((navItem) => navItem.classList.remove("active"));
            item.classList.add("active");
        });
    });

    const purposeLine = byId("purpose-line");
    const purposeHeadlines = [
        "Predict arrival windows.",
        "Balance demand and capacity.",
        "Protect feasible connections.",
        "Adapt when service is disrupted."
    ];
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const renderPurposeHeadline = (text, animate) => {
        purposeLine.setAttribute("aria-label", text);
        if (!animate) {
            purposeLine.textContent = text;
            return;
        }
        const letters = Array.from(text, (character, index) => {
            const letter = document.createElement("span");
            letter.className = "purpose-letter";
            letter.textContent = character;
            letter.style.animationDelay = `${index * 28}ms`;
            return letter;
        });
        purposeLine.replaceChildren(...letters);
    };
    if (purposeLine) renderPurposeHeadline(purposeHeadlines[0], !reduceMotion);
    if (purposeLine && !reduceMotion) {
        let headlineIndex = 0;
        window.setInterval(() => {
            if (document.hidden) return;
            headlineIndex = (headlineIndex + 1) % purposeHeadlines.length;
            purposeLine.classList.add("is-changing");
            window.setTimeout(() => {
                renderPurposeHeadline(purposeHeadlines[headlineIndex], true);
                purposeLine.classList.remove("is-changing");
            }, 180);
        }, 4200);
    }

    byId("today-label").textContent = "WEEKDAY SIM";
    setScenario("normal");
})();