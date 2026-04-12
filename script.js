"use strict";

/* =========================
   1. CONSTANTS & APP STATE
========================= */
const MODES = {
    MANUAL: "MANUAL",
    AUTO: "AUTO",
    EMERGENCY: "EMERGENCY",
};

const STEP = {
    READY: 0,
    FIND_ITEM: 1,
    PICKING: 2,
    RETURNING: 3,
    DROPPING: 4,
    DONE: 5,
    LINE_LOST: 99,
};

const MOVE_CODES = {
    S: 0,
    F: 1,
    B: 2,
    L: 3,
    R: 4,
};

const JOINTS_WITH_NAMES = [
    { id: 1, label: "Base", actionName: "Servo_Base", min: 0, max: 180, home: 70 },
    { id: 2, label: "Shoulder", actionName: "Servo_Shoulder", min: 0, max: 160, home: 90 },
    { id: 3, label: "Elbow", actionName: "Servo_Elbow", min: 20, max: 160, home: 90 },
    { id: 4, label: "Wrist Pitch", actionName: "Servo_Wrist_Pitch", min: 30, max: 140, home: 60 },
    { id: 5, label: "Wrist Roll", actionName: "Servo_Wrist_Roll", min: 0, max: 180, home: 110 },
    { id: 6, label: "Gripper", actionName: "Servo_Gripper", min: 10, max: 160, home: 160 },
];

const GRIPPER_CLOSE_ANGLE = 10;
const GRIPPER_OPEN_ANGLE = 160;
const appState = {
    currentMode: MODES.MANUAL,
    currentStep: STEP.READY,

    isDriveEnabled: false,
    isAutoRunning: false,
    autoTimer: null,
    lastMoveDirection: "S",

    packageCount: 0,
    currentWMSId: null,
    activePickupTime: null,

    isHandlingPickDrop: false,
    gripperState: "OPEN",

    isEraConfigured: false,
    missingActions: [],
    configLockedControls: {},
    runtimeLocked: false,
    currentMissionId: null,
    missionStartTime: null,
};

/* =========================
   2. DOM HELPERS
========================= */
function el(id) {
    return document.getElementById(id);
}

function getTerminal() {
    return el("terminalBox");
}

function getTimeString(date = new Date()) {
    return date.toLocaleTimeString("vi-VN", { hour12: false });
}

function getDateString(date = new Date()) {
    return date.toLocaleDateString("vi-VN");
}

function clamp(val, min, max) {
    return Math.max(min, Math.min(max, Number(val)));
}

function formatDuration(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return m > 0 ? `${m}p ${s}s` : `${s} giây`;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeText(s) {
    return String(s || "")
        .toLowerCase()
        .trim()
        .replace(/[\s_-]+/g, "");
}

/* =========================
   3. LOGGING
========================= */
function printLog(message, type = "normal") {
    const box = getTerminal();
    if (!box) return;

    const time = getTimeString();

    let style = "";
    if (type === "error") style = "color: var(--color-red);";
    if (type === "success") style = "color: #10b981;";
    if (type === "warn") style = "color: #f59e0b;";
    if (type === "info") style = "color: #3b82f6;";

    box.innerHTML += `
        <div class="log-line" style="${style}">
            <span class="time">[${time}]</span> ${message}
        </div>
    `;
    box.scrollTop = box.scrollHeight;
}

/* =========================
   4. E-RA WIDGET
========================= */
const eraWidget = new EraWidget();

const eraActions = {
    moveStop: null,
    moveForward: null,
    moveBackward: null,
    moveLeft: null,
    moveRight: null,

    runEnable: null,
    runDisable: null,

    emergencyOn: null,
    emergencyOff: null,
    modeManual: null,
    modeAuto: null,
    servoBase: null,
    servoShoulder: null,
    servoElbow: null,
    servoWristPitch: null,
    servoWristRoll: null,
    servoGripper: null,

    gripperClose: null,
    gripperOpen: null,
    resetArm: null,
};

const eraRealtimeConfigs = {
    missionStep: null,
    emergencyState: null,
    totalCount: null,
};

function initEraWidget() {
    eraWidget.init({
        onConfiguration: (configuration) => {
            bindEraConfiguration(configuration);
            validateEraBindings();
            appState.isEraConfigured = true;
            updateConnectionStatus(true);
            printLog("Đã nhận cấu hình từ E-Ra.", "success");
            console.log("[E-Ra configuration]", configuration);
            console.log("[Mapped actions]", eraActions);
            console.log("[Mapped realtime]", eraRealtimeConfigs);
        },
        onValues: (values) => {
            handleEraValues(values);
        },
    });
}

function bindEraConfiguration(configuration) {
    const actions = Array.isArray(configuration?.actions) ? configuration.actions : [];
    const realtimeConfigs = Array.isArray(configuration?.realtime_configs)
        ? configuration.realtime_configs
        : [];

    eraActions.moveStop = findActionFlexible(actions, ["Move_Stop", "Stop"]);
    eraActions.moveForward = findActionFlexible(actions, ["Move_Forward", "Forward"]);
    eraActions.moveBackward = findActionFlexible(actions, ["Move_Backward", "Backward"]);
    eraActions.moveLeft = findActionFlexible(actions, ["Move_Left", "Left"]);
    eraActions.moveRight = findActionFlexible(actions, ["Move_Right", "Right"]);

    eraActions.runEnable = findActionFlexible(actions, ["Run_Enable", "RunON", "Run ON", "Start"]);
    eraActions.runDisable = findActionFlexible(actions, ["Run_Disable", "RunOFF", "Run OFF"]);

    eraActions.emergencyOn = findActionFlexible(actions, ["Emergency_On", "EMGON", "EmergencyON"]);
    eraActions.emergencyOff = findActionFlexible(actions, ["Emergency_Off", "EMGOFF", "EmergencyOFF"]);
    eraActions.modeManual = findActionFlexible(actions, ["Mode_Manual", "ModeManual", "Set_Manual"]);
    eraActions.modeAuto = findActionFlexible(actions, ["Mode_Auto", "ModeAuto", "Set_Auto"]);
    eraActions.servoBase = findActionFlexible(actions, ["Servo_Base", "Base"]);
    eraActions.servoShoulder = findActionFlexible(actions, ["Servo_Shoulder", "Shoulder"]);
    eraActions.servoElbow = findActionFlexible(actions, ["Servo_Elbow", "Elbow"]);
    eraActions.servoWristPitch = findActionFlexible(actions, ["Servo_Wrist_Pitch", "WristPitch"]);
    eraActions.servoWristRoll = findActionFlexible(actions, ["Servo_Wrist_Roll", "WristRoll"]);
    eraActions.servoGripper = findActionFlexible(actions, ["Servo_Gripper", "Gripper"]);
    eraActions.resetArm = findActionFlexible(actions, ["Reset_Arm", "ResetArm", "Reset Arm"]);
    eraActions.gripperClose = findActionFlexible(actions, ["Gripper_Close", "Manual_Pick", "Pick"]);
    eraActions.gripperOpen = findActionFlexible(actions, ["Gripper_Open", "Manual_Drop", "Drop"]);
    eraRealtimeConfigs.missionStep = findRealtimeConfigFlexible(realtimeConfigs, [
        "mission_step", "step", "agv_step", "auto_step"
    ]);

    eraRealtimeConfigs.emergencyState = findRealtimeConfigFlexible(realtimeConfigs, [
        "emergency_state", "emergencystate", "emergency", "emg", "locked"
    ]);

    eraRealtimeConfigs.totalCount = findRealtimeConfigFlexible(realtimeConfigs, [
        "total_count", "totalcount", "total", "package_count"
    ]);
}

function findActionFlexible(actions, keywords) {
    const normalizedKeywords = keywords.map(normalizeText);

    const mapped = actions.map((item) => {
        const candidates = [
            item?.name,
            item?.label,
            item?.title,
            item?.action,
            item?.id,
        ].filter(Boolean);

        return {
            item,
            normalizedCandidates: candidates.map(normalizeText),
        };
    });

    for (const key of normalizedKeywords) {
        const exact = mapped.find((entry) =>
            entry.normalizedCandidates.some((v) => v === key)
        );
        if (exact) return exact.item;
    }

    for (const key of normalizedKeywords) {
        const partial = mapped.find((entry) =>
            entry.normalizedCandidates.some((v) => v.includes(key))
        );
        if (partial) return partial.item;
    }

    return null;
}

function findRealtimeConfigFlexible(configs, keywords) {
    const normalizedKeywords = keywords.map(normalizeText);

    const mapped = configs.map((item) => {
        const candidates = [
            item?.name,
            item?.label,
            item?.title,
            item?.id,
        ].filter(Boolean);

        return {
            item,
            normalizedCandidates: candidates.map(normalizeText),
        };
    });

    for (const key of normalizedKeywords) {
        const exact = mapped.find((entry) =>
            entry.normalizedCandidates.some((v) => v === key)
        );
        if (exact) return exact.item;
    }

    for (const key of normalizedKeywords) {
        const partial = mapped.find((entry) =>
            entry.normalizedCandidates.some((v) => v.includes(key))
        );
        if (partial) return partial.item;
    }

    return null;
}

function getEraActionKey(actionObj) {
    return actionObj?.action ?? actionObj?.id ?? actionObj?.name ?? null;
}

function triggerEraAction(actionObj, value = undefined) {
    const actionKey = getEraActionKey(actionObj);

    if (!actionObj || !actionKey) {
        printLog("Thiếu action E-Ra tương ứng. Kiểm tra cấu hình widget.", "error");
        return false;
    }

    try {
        if (value === undefined) {
            eraWidget.triggerAction(actionKey, null);
        } else {
            eraWidget.triggerAction(actionKey, null, { value });
        }
        return true;
    } catch (err) {
        console.error(err);
        printLog("Gửi action lên E-Ra thất bại.", "error");
        return false;
    }
}

function getRealtimeValue(values, configObj) {
    if (!configObj?.id) return undefined;
    return values?.[configObj.id]?.value;
}

function validateEraBindings() {
    const missing = [];

    // ===== MOVE =====
    if (!eraActions.moveStop) missing.push("Move_Stop");
    if (!eraActions.moveForward) missing.push("Move_Forward");
    if (!eraActions.moveBackward) missing.push("Move_Backward");
    if (!eraActions.moveLeft) missing.push("Move_Left");
    if (!eraActions.moveRight) missing.push("Move_Right");

    // ===== RUN =====
    if (!eraActions.runEnable) missing.push("Run_Enable");
    if (!eraActions.runDisable) missing.push("Run_Disable");

    // ===== EMERGENCY =====
    if (!eraActions.emergencyOn) missing.push("Emergency_On");
    if (!eraActions.emergencyOff) missing.push("Emergency_Off");

    // ===== MODE =====
    if (!eraActions.modeManual) missing.push("Mode_Manual");
    if (!eraActions.modeAuto) missing.push("Mode_Auto");

    // ===== SERVO =====
    JOINTS_WITH_NAMES.forEach((joint) => {
        if (!getServoActionById(joint.id)) {
            missing.push(joint.actionName);
        }
    });

    // ===== GRIPPER =====
    if (!eraActions.gripperClose) missing.push("Gripper_Close");
    if (!eraActions.gripperOpen) missing.push("Gripper_Open");
    if (!eraActions.resetArm) missing.push("Reset_Arm");
    appState.missingActions = missing;

    applyConfigStateToUI();

    if (missing.length > 0) {
        printLog(`Thiếu cấu hình action: ${missing.join(", ")}`, "error");
    } else {
        printLog("Cấu hình action E-Ra đầy đủ.", "success");
    }
}

function updateConnectionStatus(isConnected) {
    const indicator = el("connStatus");
    if (!indicator) return;

    indicator.style.background = isConnected ? "#10b981" : "#ef4444";
    indicator.style.boxShadow = isConnected
        ? "0 0 12px rgba(16,185,129,0.7)"
        : "0 0 12px rgba(239,68,68,0.7)";
}
function hasMissingAction(actionNames = []) {
    return actionNames.some((name) => appState.missingActions.includes(name));
}

function setControlState(element, options = {}) {
    if (!element) return;

    const {
        disabled = false,
        configError = false,
        title = "",
    } = options;

    element.disabled = disabled;
    element.style.pointerEvents = disabled ? "none" : "auto";
    element.style.cursor = disabled ? "not-allowed" : "";
    element.style.opacity = disabled ? "0.6" : "";
    element.title = title;

    if (configError) {
        element.style.borderColor = "var(--color-red)";
        element.style.boxShadow = "0 0 12px rgba(239, 68, 68, 0.35)";
    } else {
        element.style.borderColor = "";
        element.style.boxShadow = "";
    }
}
function refreshControlStates() {
    const btnManual = el("btnManual");
    const btnAuto = el("btnAuto");
    const btnEmergency = el("btnEmergency");
    const btnStopControl = el("btnStopControl");
    const btnPick = el("btnPick");
    const btnDrop = el("btnDrop");
    const btnResetArm = el("btnResetArm");

    const moveButtons = document.querySelectorAll(".btn-dir[data-dir]");
    const armInputs = document.querySelectorAll(".joint-input, #armControlsGrid input[type='range']");

    const cfg = appState.configLockedControls || {};
    const runtimeLocked = !!appState.runtimeLocked;

    // Mode buttons
    setControlState(btnManual, {
        disabled: runtimeLocked || !!cfg.btnManual,
        configError: !!cfg.btnManual,
        title: cfg.btnManual ? "Thiếu action Mode_Manual / Mode_Auto" : "",
    });

    setControlState(btnAuto, {
        disabled: runtimeLocked || !!cfg.btnAuto,
        configError: !!cfg.btnAuto,
        title: cfg.btnAuto ? "Thiếu action Mode_Manual / Mode_Auto" : "",
    });

    // Emergency
    setControlState(btnEmergency, {
        disabled: !!cfg.btnEmergency,
        configError: !!cfg.btnEmergency,
        title: cfg.btnEmergency ? "Thiếu action Emergency_On / Emergency_Off" : "",
    });

    // Start/Stop trung tâm
    setControlState(btnStopControl, {
        disabled: !!cfg.btnStopControl,
        configError: !!cfg.btnStopControl,
        title: cfg.btnStopControl ? "Thiếu action Run hoặc Move" : "",
    });

    // Move buttons
    moveButtons.forEach((btn) => {
        setControlState(btn, {
            disabled: runtimeLocked || !!cfg.moveButtons,
            configError: !!cfg.moveButtons,
            title: cfg.moveButtons ? "Thiếu action Move" : "",
        });
    });

    // Pick / Drop
    setControlState(btnPick, {
        disabled: runtimeLocked || !!cfg.btnPick,
        configError: !!cfg.btnPick,
        title: cfg.btnPick ? "Thiếu action Gripper/Servo" : "",
    });

    setControlState(btnDrop, {
        disabled: runtimeLocked || !!cfg.btnDrop,
        configError: !!cfg.btnDrop,
        title: cfg.btnDrop ? "Thiếu action Gripper/Servo" : "",
    });

    // Reset Arm
    setControlState(btnResetArm, {
        disabled: runtimeLocked || !!cfg.btnResetArm,
        configError: !!cfg.btnResetArm,
        title: cfg.btnResetArm ? "Thiếu action Reset_Arm" : "",
    });

    // Servo inputs
    armInputs.forEach((node) => {
        setControlState(node, {
            disabled: runtimeLocked || !!cfg.armInputs,
            configError: !!cfg.armInputs,
            title: cfg.armInputs ? "Thiếu action Servo" : "",
        });
    });
}
function applyConfigStateToUI() {
    const missingMove = hasMissingAction([
        "Move_Stop",
        "Move_Forward",
        "Move_Backward",
        "Move_Left",
        "Move_Right",
    ]);
    const missingResetArm = hasMissingAction([
        "Reset_Arm",
    ]);
    const missingRun = hasMissingAction([
        "Run_Enable",
        "Run_Disable",
    ]);

    const missingEmergency = hasMissingAction([
        "Emergency_On",
        "Emergency_Off",
    ]);

    const missingMode = hasMissingAction([
        "Mode_Manual",
        "Mode_Auto",
    ]);

    const missingServo = hasMissingAction([
        "Servo_Base",
        "Servo_Shoulder",
        "Servo_Elbow",
        "Servo_Wrist_Pitch",
        "Servo_Wrist_Roll",
        "Servo_Gripper",
    ]);

    const missingGripper = hasMissingAction([
        "Gripper_Close",
        "Gripper_Open",
    ]);

    appState.configLockedControls = {
        btnManual: missingMode,
        btnAuto: missingMode,
        btnEmergency: missingEmergency,
        btnStopControl: missingRun || missingMove,
        moveButtons: missingMove,
        btnPick: missingGripper || missingServo,
        btnDrop: missingGripper || missingServo,
        btnResetArm: missingResetArm,
        armInputs: missingServo,
    };

    refreshControlStates();
}
/* =========================
   5. BOOTSTRAP
========================= */
document.addEventListener("DOMContentLoaded", () => {
    initDashboard();
    bindUIEvents();
    initEraWidget();
});

/* =========================
   6. INIT UI
========================= */
function initDashboard() {
    renderArmControls();
    startClock();
    setMode(MODES.MANUAL, { silent: true });
    updateTotalCountUI();
    updateConnectionStatus(false);
    applyConfigStateToUI();
    printLog("Dashboard đã khởi tạo.", "info");
}

function renderArmControls() {
    const armHeader = document.querySelector(".arm-panel-header");
    if (armHeader && !el("btnResetArm")) {
        const btn = document.createElement("button");
        btn.id = "btnResetArm";
        btn.className = "btn-reset-arm";
        btn.textContent = "Reset về góc mặc định";
        armHeader.appendChild(btn);
    }

    const armGrid = el("armControlsGrid");
    if (!armGrid || armGrid.children.length > 0) return;

    JOINTS_WITH_NAMES.forEach((joint) => {
        const wrapper = document.createElement("div");
        wrapper.className = "joint-widget";
        wrapper.innerHTML = `
            <div class="joint-header">
                <span>J${joint.id}: ${joint.label}</span>
                <div class="input-container">
                    <input
                        type="number"
                        id="num${joint.id}"
                        class="joint-input"
                        value="${joint.home}"
                        min="${joint.min}"
                        max="${joint.max}"
                    >
                    <div class="input-tooltip">Nhập từ ${joint.min}° - ${joint.max}°</div>
                </div>
            </div>
            <input
                type="range"
                id="range${joint.id}"
                min="${joint.min}"
                max="${joint.max}"
                value="${joint.home}"
            >
        `;
        armGrid.appendChild(wrapper);
    });

    JOINTS_WITH_NAMES.forEach((joint) => {
        const numInput = el(`num${joint.id}`);
        const rangeInput = el(`range${joint.id}`);

        if (numInput) {
            numInput.addEventListener("change", () => syncFromNum(joint.id));
            numInput.addEventListener("blur", () => syncFromNum(joint.id));
        }

        if (rangeInput) {
            rangeInput.addEventListener("input", () => syncFromRange(joint.id));
            rangeInput.addEventListener("change", () => sendArmCommand(joint.id, rangeInput.value));
        }
    });
}
function startClock() {
    const update = () => {
        const timeEl = el("sysTime");
        if (timeEl) {
            timeEl.innerText = new Date().toLocaleTimeString("vi-VN", {
                hour12: false,
            });
        }
    };
    update();
    setInterval(update, 1000);
}

/* =========================
   7. EVENT BINDING
========================= */
function bindUIEvents() {
    const btnManual = el("btnManual");
    const btnAuto = el("btnAuto");
    const btnEmergency = el("btnEmergency");
    const btnDismissAlert = el("btnDismissAlert");
    const btnStopControl = el("btnStopControl");
    const btnPick = el("btnPick");
    const btnDrop = el("btnDrop");
    const btnExportWMS = el("btnExportWMS");
    const btnExportMissionCSV = el("btnExportMissionCSV");
    const btnTestLineLost = el("btnTestLineLost");
    const btnResetArm = el("btnResetArm");

    if (btnManual) btnManual.addEventListener("click", () => setMode(MODES.MANUAL));
    if (btnAuto) btnAuto.addEventListener("click", () => setMode(MODES.AUTO));
    if (btnEmergency) btnEmergency.addEventListener("click", handleEmergencyButton);
    if (btnDismissAlert) btnDismissAlert.addEventListener("click", dismissAlert);
    if (btnStopControl) btnStopControl.addEventListener("click", toggleCenterButton);
    if (btnPick) btnPick.addEventListener("click", manualPick);
    if (btnDrop) btnDrop.addEventListener("click", manualDrop);
    if (btnExportWMS) btnExportWMS.addEventListener("click", exportWMS);
    if (btnExportMissionCSV) btnExportMissionCSV.addEventListener("click", exportMissionHistoryCSV);
    if (btnTestLineLost) btnTestLineLost.addEventListener("click", showAlert);
    if (btnResetArm) btnResetArm.addEventListener("click", resetArm);

    const dirButtons = document.querySelectorAll(".btn-dir[data-dir]");
    dirButtons.forEach((btn) => {
        const dir = btn.dataset.dir;

        btn.addEventListener("pointerdown", (e) => {
            e.preventDefault();
            move(dir);
        });

        const stopMovement = (e) => {
            if (e) e.preventDefault();
            move("S");
        };

        btn.addEventListener("pointerup", stopMovement);
        btn.addEventListener("pointerleave", stopMovement);
        btn.addEventListener("pointercancel", stopMovement);
    });
}

/* =========================
   8. UI HELPERS
========================= */
function setDriveEnabled(enabled) {
    appState.isDriveEnabled = enabled;

    const stopBtn = el("btnStopControl");
    if (!stopBtn) return;

    if (appState.currentMode === MODES.EMERGENCY) {
        stopBtn.innerHTML = "<span>LOCKED</span>";
        stopBtn.classList.remove("is-start", "is-auto-start");
        stopBtn.classList.add("is-stop");
        return;
    }

    if (enabled) {
        stopBtn.innerHTML = "<span>STOP</span>";
        stopBtn.classList.remove("is-start", "is-auto-start");
        stopBtn.classList.add("is-stop");
    } else {
        stopBtn.innerHTML = "<span>START</span>";
        stopBtn.classList.remove("is-stop", "is-auto-start");
        stopBtn.classList.add("is-start");
    }
}

function setRuntimeLock(locked) {
    appState.runtimeLocked = !!locked;
    refreshControlStates();
}
function clearAutoTimer() {
    if (appState.autoTimer) {
        clearInterval(appState.autoTimer);
        appState.autoTimer = null;
    }
}

function clearLineLostOverlay() {
    const alertBox = el("lineAlert");
    if (alertBox) alertBox.style.display = "none";
}

function stopAllMotion() {
    clearAutoTimer();
    appState.isAutoRunning = false;
    appState.lastMoveDirection = "S";

    if (eraActions.moveStop) {
        triggerFixedMoveAction("S");
    }
}

function updateTotalCountUI() {
    const totalCountEl = el("totalCount");
    if (totalCountEl) {
        totalCountEl.innerText = String(appState.packageCount).padStart(2, "0");
    }
}

function updateModeUI(mode) {
    const modeDisplay = el("modeDisplay");
    const btnManual = el("btnManual");
    const btnAuto = el("btnAuto");
    const statusObj = el("missionStatus");
    const stopBtn = el("btnStopControl");

    if (modeDisplay) {
        modeDisplay.innerText = mode === MODES.EMERGENCY ? "EMG-LOCKED" : mode;
    }

    if (btnManual) btnManual.classList.toggle("active", mode === MODES.MANUAL);
    if (btnAuto) btnAuto.classList.toggle("active-auto", mode === MODES.AUTO);

    if (stopBtn) {
        stopBtn.style.background = "";
        stopBtn.style.boxShadow = "";
        stopBtn.style.color = "";
        stopBtn.style.borderColor = "";
    }

    if (statusObj) {
        statusObj.classList.remove("moving-status", "done-status", "ready-status");

        if (mode === MODES.MANUAL) {
            statusObj.innerText = "Chế độ tay";
        } else if (mode === MODES.AUTO) {
            statusObj.innerText = "Sẵn sàng";
            statusObj.classList.add("ready-status");
        } else {
            statusObj.innerText = "Khóa khẩn cấp";
        }
    }
}

function resetMissionFlowUI() {
    for (let i = 0; i <= 5; i++) {
        const step = el(`step${i}`);
        if (step) step.classList.remove("active", "done");
    }

    for (let i = 0; i <= 4; i++) {
        const line = el(`line${i}`);
        if (line) line.classList.remove("done");
    }

    const step0 = el("step0");
    if (step0) step0.classList.add("active");
}

/* =========================
   9. MODE MANAGEMENT
========================= */
function setMode(mode, options = {}) {
    const { silent = false } = options;

    if (appState.currentMode === MODES.EMERGENCY && mode !== MODES.MANUAL) {
        printLog("HỆ THỐNG ĐANG KHÓA CỨNG! Hãy nhấn RESET SYSTEM trên nút màu đỏ.", "error");
        return;
    }

    if (mode === MODES.MANUAL) {
        if (appState.currentMode === MODES.AUTO) {
            appState.isAutoRunning = false;
            clearAutoTimer();
            sendRunDisable();
            stopAllMotion();
        }

        clearLineLostOverlay();
        appState.currentMode = MODES.MANUAL;
        appState.currentStep = STEP.READY;
        appState.lastMoveDirection = "S";

        setRuntimeLock(false);
        updateModeUI(MODES.MANUAL);
        resetMissionFlowUI();
        setDriveEnabled(false);

        sendModeState(MODES.MANUAL);

        if (!silent) printLog(`Mode → MANUAL | Step reset | Drive OFF`, "info");
        return;
    }

    if (mode === MODES.AUTO) {
        stopAllMotion();
        clearLineLostOverlay();

        appState.currentMode = MODES.AUTO;
        appState.currentStep = STEP.READY;
        appState.lastMoveDirection = "S";

        setRuntimeLock(false);
        updateModeUI(MODES.AUTO);
        setMissionStep(STEP.READY);
        setDriveEnabled(false);

        sendModeState(MODES.AUTO);

        if (!silent) printLog(`Mode → AUTO | Waiting for line...`, "info");
        return;
    }
}
function sendModeState(mode) {
    if (!appState.isEraConfigured) {
        return false;
    }

    let ok = false;

    if (mode === MODES.MANUAL) {
        if (!eraActions.modeManual) {
            printLog("Thiếu action Mode_Manual trên E-Ra.", "warn");
            return false;
        }
        ok = triggerEraAction(eraActions.modeManual);
    } else if (mode === MODES.AUTO) {
        if (!eraActions.modeAuto) {
            printLog("Thiếu action Mode_Auto trên E-Ra.", "warn");
            return false;
        }
        ok = triggerEraAction(eraActions.modeAuto);
    }

    if (ok) {
        printLog(`Đã gửi action mode: ${mode}`, "info");
    }

    return ok;
}
/* =========================
   10. DRIVE & RUN CONTROL
========================= */
function sendRunEnable() {
    if (eraActions.runEnable) {
        return triggerEraAction(eraActions.runEnable);
    }
    return true;
}

function sendRunDisable() {
    let ok = true;

    if (eraActions.runDisable) {
        ok = triggerEraAction(eraActions.runDisable);
    }

    if (eraActions.moveStop) {
        triggerFixedMoveAction("S");
    }

    return ok;
}

function triggerFixedMoveAction(direction) {
    const actionMap = {
        S: eraActions.moveStop,
        F: eraActions.moveForward,
        B: eraActions.moveBackward,
        L: eraActions.moveLeft,
        R: eraActions.moveRight,
    };

    const actionObj = actionMap[direction];
    if (!actionObj) {
        printLog(`Thiếu action di chuyển cho hướng ${direction}`, "error");
        return false;
    }

    return triggerEraAction(actionObj);
}

function toggleCenterButton() {
    if (appState.currentMode === MODES.EMERGENCY) {
        printLog("HỆ THỐNG ĐANG KHÓA!", "error");
        return;
    }

    if (appState.currentMode === MODES.AUTO) {
        if (!appState.isAutoRunning) {
            const ok = sendRunEnable();
            if (!ok) return;

            appState.isAutoRunning = true;
            setDriveEnabled(true);
            printLog("AUTO: Bắt đầu vòng lặp tự động.", "success");
            startAutoLogic();
        } else {
            appState.isAutoRunning = false;
            clearAutoTimer();
            sendRunDisable();
            stopAllMotion();
            setDriveEnabled(false);
            printLog("AUTO: Đã dừng.", "warn");
        }
        return;
    }

    if (!appState.isDriveEnabled) {
        const ok = sendRunEnable();
        if (!ok) return;

        setDriveEnabled(true);
        printLog("MANUAL: Hệ thống sẵn sàng điều khiển.", "success");
    } else {
        sendRunDisable();
        stopAllMotion();
        setDriveEnabled(false);
        printLog("MANUAL: Đã dừng xe. (Ấn START để tiếp tục)", "warn");
    }
}

function move(direction) {
    if (!(direction in MOVE_CODES)) return;

    if (appState.currentMode === MODES.EMERGENCY) {
        if (direction !== "S") {
            printLog("HỆ THỐNG ĐANG KHÓA! Hãy nhấn RESET SYSTEM trên nút màu đỏ.", "error");
        }
        return;
    }

    if (appState.currentMode === MODES.AUTO) {
        if (direction !== "S") {
            printLog("Lỗi: Đang AUTO!", "error");
        }
        return;
    }

    if (!appState.isDriveEnabled) {
        if (direction !== "S") {
            printLog("Lỗi: Hãy nhấn START để mở khóa điều khiển!", "error");
        }
        return;
    }

    if (direction === appState.lastMoveDirection) return;

    if (direction !== "S") {
        createWMSRecord("MANUAL");

        const moved = triggerFixedMoveAction(direction);
        if (moved) {
            appState.lastMoveDirection = direction;
            printLog(`Motor Drive: ${direction} (Mã: ${MOVE_CODES[direction]})`, "info");
        }
        return;
    }

    const stopped = triggerFixedMoveAction("S");
    if (stopped) {
        appState.lastMoveDirection = "S";
    }
}

function startAutoLogic() {
    clearAutoTimer();

    appState.autoTimer = setInterval(() => {
        if (appState.currentMode !== MODES.AUTO || !appState.isAutoRunning) {
            clearAutoTimer();
            return;
        }

        // giữ chế độ AUTO chạy vòng lặp liên tục
        // controller (Raspberry / firmware) sẽ xử lý line-follow và mission thực tế
    }, 300);
}

/* =========================
   11. EMERGENCY
========================= */
function handleEmergencyButton() {
    if (appState.currentMode === MODES.EMERGENCY) {
        if (eraActions.emergencyOff) {
            const ok = triggerEraAction(eraActions.emergencyOff);
            if (!ok) return;
            setTimeout(() => resetFromEmergency(false), 300);
        } else {
            resetFromEmergency(true);
        }
    } else {
        if (eraActions.emergencyOn) {
            const ok = triggerEraAction(eraActions.emergencyOn);
            if (!ok) return;
        }
        triggerEmergency(false);
    }
}

function triggerEmergency(sendToEra = true) {
    appState.currentMode = MODES.EMERGENCY;
    appState.currentStep = STEP.READY;
    appState.isAutoRunning = false;
    appState.lastMoveDirection = "S";

    setDriveEnabled(false);
    stopAllMotion();

    const emerBtn = el("btnEmergency");
    const stopBtn = el("btnStopControl");

    if (sendToEra && eraActions.emergencyOn) {
        triggerEraAction(eraActions.emergencyOn);
    }

    if (emerBtn) {
        emerBtn.innerText = "RESET SYSTEM";
        emerBtn.classList.add("active-emergency");
    }

    if (stopBtn) {
        stopBtn.classList.remove("is-start", "is-auto-start");
        stopBtn.classList.add("is-stop");
        stopBtn.innerHTML = "<span>LOCKED</span>";
        stopBtn.style.background = "var(--color-red)";
        stopBtn.style.color = "#fff";
        stopBtn.style.borderColor = "#ef4444";
        stopBtn.style.boxShadow = "0 0 20px rgba(239, 68, 68, 0.5)";
    }

    updateModeUI(MODES.EMERGENCY);
    setRuntimeLock(true);
    resetMissionFlowUI();

    printLog("⚠️ EMERGENCY: Hệ thống đã khóa. Nhấn RESET để tiếp tục!", "error");
}

function resetFromEmergency(sendToEra = true) {
    printLog("Hệ thống: Đang giải phóng lệnh khóa...", "info");

    if (sendToEra && eraActions.emergencyOff) {
        const ok = triggerEraAction(eraActions.emergencyOff);
        if (!ok) return;
    }

    const emerBtn = el("btnEmergency");
    const stopBtn = el("btnStopControl");

    if (emerBtn) {
        emerBtn.innerText = "EMERGENCY";
        emerBtn.classList.remove("active-emergency");
    }

    if (stopBtn) {
        stopBtn.style.background = "";
        stopBtn.style.color = "";
        stopBtn.style.borderColor = "";
        stopBtn.style.boxShadow = "";
        stopBtn.classList.remove("is-stop", "is-auto-start");
        stopBtn.classList.add("is-start");
        stopBtn.innerHTML = "<span>START</span>";
    }

    appState.currentMode = MODES.MANUAL;
    appState.currentStep = STEP.READY;
    appState.isAutoRunning = false;
    appState.isDriveEnabled = false;
    appState.lastMoveDirection = "S";

    clearAutoTimer();
    clearLineLostOverlay();
    setRuntimeLock(false);
    updateModeUI(MODES.MANUAL);
    resetMissionFlowUI();
    setDriveEnabled(false);

    sendModeState(MODES.MANUAL);

    printLog("Hệ thống: Đã mở khóa hoàn toàn.", "success");
}
function ensureManualServoControl(actionName = "thao tác servo") {
    if (appState.currentMode === MODES.EMERGENCY) {
        printLog("LỖI: Tay máy bị khóa cứng do EMERGENCY!", "error");
        return false;
    }

    if (appState.currentMode !== MODES.MANUAL) {
        printLog(`Lỗi: Không thể ${actionName} khi đang ở AUTO`, "error");
        return false;
    }

    return true;
}
/* =========================
   12. SERVO / ARM CONTROL
========================= */
function getServoActionById(id) {
    switch (id) {
        case 1: return eraActions.servoBase;
        case 2: return eraActions.servoShoulder;
        case 3: return eraActions.servoElbow;
        case 4: return eraActions.servoWristPitch;
        case 5: return eraActions.servoWristRoll;
        case 6: return eraActions.servoGripper;
        default: return null;
    }
}
function getJointConfigById(id) {
    return JOINTS_WITH_NAMES.find((joint) => joint.id === id) || null;
}
function sendArmCommand(id, value) {
    if (!ensureManualServoControl("điều khiển tay máy")) return false;

    const joint = getJointConfigById(id);
    if (!joint) {
        printLog(`Không tìm thấy cấu hình khớp J${id}`, "error");
        return false;
    }

    const safeValue = clamp(value, joint.min, joint.max);
    const action = getServoActionById(id);
    const jointName = joint.label;

    if (!action) {
        printLog(`Thiếu action servo cho ${jointName}`, "error");
        return false;
    }

    const ok = triggerEraAction(action, safeValue);
    if (!ok) {
        return false;
    }

    if (id === 6) {
        appState.gripperState = safeValue <= 85 ? "CLOSED" : "OPEN";
    }

    printLog(`Khớp ${jointName} (J${id}) -> ${safeValue}°`, "info");
    return true;
}

function syncFromNum(id) {
    const numInput = el(`num${id}`);
    const rangeInput = el(`range${id}`);
    const joint = getJointConfigById(id);

    if (!numInput || !rangeInput || !joint) return;

    const val = clamp(numInput.value, joint.min, joint.max);
    numInput.value = val;
    rangeInput.value = val;
    sendArmCommand(id, val);
}

function syncFromRange(id) {
    const numInput = el(`num${id}`);
    const rangeInput = el(`range${id}`);
    const joint = getJointConfigById(id);

    if (!numInput || !rangeInput || !joint) return;

    const val = clamp(rangeInput.value, joint.min, joint.max);
    numInput.value = val;
}

async function resetArm() {
    if (!ensureManualServoControl("reset tay máy")) return;

    if (appState.isHandlingPickDrop) {
        printLog("Tay gắp đang xử lý thao tác khác, vui lòng chờ.", "warn");
        return;
    }

    if (!eraActions.resetArm) {
        printLog("Thiếu action Reset_Arm trên E-Ra.", "error");
        return;
    }

    const ok = triggerEraAction(eraActions.resetArm);
    if (!ok) {
        printLog("Gửi lệnh Reset_Arm thất bại.", "error");
        return;
    }

    printLog("Đã gửi lệnh Reset_Arm tới ESP32.", "info");

    // cập nhật UI tạm thời về home
    JOINTS_WITH_NAMES.forEach((joint) => {
        const numInput = el(`num${joint.id}`);
        const rangeInput = el(`range${joint.id}`);

        if (numInput) numInput.value = joint.home;
        if (rangeInput) rangeInput.value = joint.home;
    });

    appState.gripperState = "OPEN";
}
/* =========================
   13. WMS SHARED (MANUAL + AUTO)
========================= */
function getNextWmsId() {
    const rows = [...document.querySelectorAll("#wmsBody tr[id^='pkg-row-']")];
    const ids = rows
        .map((row) => Number(row.id.replace("pkg-row-", "")))
        .filter(Number.isFinite);

    return ids.length ? Math.max(...ids) + 1 : 1;
}

function scrollWmsToBottom() {
    const tableWrap = el("wmsTableWrap");
    if (tableWrap) tableWrap.scrollTop = tableWrap.scrollHeight;
}

function createWMSRecord(source = "MANUAL") {
    if (appState.currentWMSId !== null) return appState.currentWMSId;

    const tbody = el("wmsBody");
    if (!tbody) return null;

    const newId = getNextWmsId();
    const pkgCode = `PKG-${String(newId).padStart(4, "0")}`;
    const now = new Date();

    const row = document.createElement("tr");
    row.id = `pkg-row-${newId}`;
    row.innerHTML = `
        <td class="font-mono text-blue font-bold">${pkgCode}</td>
        <td>${getDateString(now)}</td>
        <td id="t-pick-${newId}" style="color: var(--text-dim);">--:--:--</td>
        <td id="t-drop-${newId}" style="color: var(--text-dim);">--:--:--</td>
        <td id="t-diff-${newId}" style="color: var(--text-dim);">Đang tính...</td>
        <td id="t-stat-${newId}">
            <span class="tag tag-warn">Đang chuẩn bị</span>
        </td>
    `;

    tbody.appendChild(row);
    scrollWmsToBottom();

    appState.currentWMSId = newId;
    appState.activePickupTime = null;

    printLog(`[WMS] Tạo phiếu vận chuyển mới: ${pkgCode} (${source})`, "info");
    return newId;
}

function markWMSPicked(recordId = appState.currentWMSId) {
    if (recordId === null) return false;

    const now = new Date();
    const pickCell = el(`t-pick-${recordId}`);
    const statCell = el(`t-stat-${recordId}`);

    if (pickCell && pickCell.innerText === "--:--:--") {
        pickCell.innerText = getTimeString(now);
        pickCell.style.color = "var(--text-main)";
        appState.activePickupTime = now;
    }

    if (statCell) {
        statCell.innerHTML = `<span class="tag tag-warn">Đang trung chuyển</span>`;
    }

    return true;
}

function markWMSDropped(recordId = appState.currentWMSId) {
    if (recordId === null) return false;
    if (!appState.activePickupTime) return false;

    const now = new Date();
    const dropCell = el(`t-drop-${recordId}`);
    const diffCell = el(`t-diff-${recordId}`);
    const statCell = el(`t-stat-${recordId}`);

    if (dropCell) {
        dropCell.innerText = getTimeString(now);
        dropCell.style.color = "var(--text-main)";
    }

    if (diffCell) {
        diffCell.innerText = formatDuration(now - appState.activePickupTime);
        diffCell.className = "text-green font-bold";
    }

    if (statCell) {
        statCell.innerHTML = `<span class="tag tag-succ">Đã nhập kho B</span>`;
    }

    appState.packageCount++;
    updateTotalCountUI();

    printLog(`[WMS] Hoàn tất kiện ${String(appState.packageCount).padStart(2, "0")}`, "success");

    appState.currentWMSId = null;
    appState.activePickupTime = null;
    return true;
}

/* =========================
   14. PICK / DROP (MANUAL)
========================= */
async function manualPick() {
    if (!ensureManualServoControl("gắp hàng")) return;

    if (appState.isHandlingPickDrop) {
        printLog("Tay gắp đang xử lý thao tác khác, vui lòng chờ.", "warn");
        return;
    }

    if (appState.gripperState === "CLOSED") {
        printLog("Gripper đang ở trạng thái đã gắp.", "warn");
        return;
    }

    if (appState.currentWMSId === null) {
        createWMSRecord("MANUAL");
    }

    appState.isHandlingPickDrop = true;

    const ok =
        triggerEraAction(eraActions.gripperClose) ||
        triggerEraAction(eraActions.servoGripper, GRIPPER_CLOSE_ANGLE);

    if (!ok) {
        appState.isHandlingPickDrop = false;
        return;
    }

    const num6 = el("num6");
    const range6 = el("range6");
    if (num6) num6.value = GRIPPER_CLOSE_ANGLE;
    if (range6) range6.value = GRIPPER_CLOSE_ANGLE;

    markWMSPicked();

    appState.gripperState = "CLOSED";
    printLog(`MANUAL: Lệnh GẮP HÀNG (${GRIPPER_CLOSE_ANGLE}°)`, "success");

    await sleep(200);
    appState.isHandlingPickDrop = false;
}

async function manualDrop() {
    if (!ensureManualServoControl("thả hàng")) return;

    if (appState.isHandlingPickDrop) {
        printLog("Tay gắp đang xử lý thao tác khác, vui lòng chờ.", "warn");
        return;
    }

    if (appState.currentWMSId === null) {
        printLog("WMS: Chưa có phiếu vận chuyển nào để DROP.", "error");
        return;
    }

    if (!appState.activePickupTime) {
        printLog("WMS: Chưa PICK hàng nên chưa thể DROP.", "error");
        return;
    }

    if (appState.gripperState === "OPEN") {
        printLog("Gripper đang mở, không thể DROP.", "warn");
        return;
    }

    appState.isHandlingPickDrop = true;

    const ok =
        triggerEraAction(eraActions.gripperOpen) ||
        triggerEraAction(eraActions.servoGripper, GRIPPER_OPEN_ANGLE);

    if (!ok) {
        appState.isHandlingPickDrop = false;
        return;
    }

    const num6 = el("num6");
    const range6 = el("range6");
    if (num6) num6.value = GRIPPER_OPEN_ANGLE;
    if (range6) range6.value = GRIPPER_OPEN_ANGLE;

    markWMSDropped();

    appState.gripperState = "OPEN";
    printLog(`MANUAL: Lệnh THẢ HÀNG (${GRIPPER_OPEN_ANGLE}°)`, "warn");

    await sleep(200);
    appState.isHandlingPickDrop = false;
}
function getNextMissionId() {
    const rows = [...document.querySelectorAll("#missionHistoryBody tr[id^='mission-row-']")];
    const ids = rows
        .map((row) => Number(row.id.replace("mission-row-", "")))
        .filter(Number.isFinite);

    return ids.length ? Math.max(...ids) + 1 : 1;
}

function scrollMissionToBottom() {
    const wrap = el("missionTableWrap");
    if (wrap) wrap.scrollTop = wrap.scrollHeight;
}

function createMissionRecord() {
    if (appState.currentMissionId !== null) return appState.currentMissionId;

    const tbody = el("missionHistoryBody");
    if (!tbody) return null;

    const newId = getNextMissionId();
    const missionCode = `MIS-${String(newId).padStart(4, "0")}`;
    const now = new Date();

    const row = document.createElement("tr");
    row.id = `mission-row-${newId}`;
    row.innerHTML = `
        <td class="font-mono text-blue font-bold">${missionCode}</td>
        <td>${getDateString(now)}</td>
        <td id="m-start-${newId}">${getTimeString(now)}</td>
        <td id="m-end-${newId}" style="color: var(--text-dim);">--:--:--</td>
        <td id="m-step-${newId}">READY</td>
        <td id="m-duration-${newId}" style="color: var(--text-dim);">Đang chạy...</td>
        <td id="m-status-${newId}">
            <span class="tag tag-warn">Đang chạy</span>
        </td>
    `;

    tbody.appendChild(row);
    scrollMissionToBottom();

    appState.currentMissionId = newId;
    appState.missionStartTime = now;

    printLog(`[MISSION] Tạo mission mới: ${missionCode}`, "info");
    return newId;
}

function updateMissionRecordStep(stepIndex, stepLabel) {
    if (appState.currentMissionId === null) return;

    const stepCell = el(`m-step-${appState.currentMissionId}`);
    const statusCell = el(`m-status-${appState.currentMissionId}`);

    if (stepCell) {
        stepCell.innerText = stepLabel || `STEP ${stepIndex}`;
    }

    if (statusCell) {
        let statusHtml = `<span class="tag tag-warn">Đang chạy</span>`;

        if (stepIndex === STEP.PICKING) {
            statusHtml = `<span class="tag tag-warn">Đang gắp</span>`;
        } else if (stepIndex === STEP.RETURNING) {
            statusHtml = `<span class="tag tag-warn">Đang quay về</span>`;
        } else if (stepIndex === STEP.DROPPING) {
            statusHtml = `<span class="tag tag-warn">Đang thả</span>`;
        } else if (stepIndex === STEP.DONE) {
            statusHtml = `<span class="tag tag-succ">Hoàn thành</span>`;
        }

        statusCell.innerHTML = statusHtml;
    }
}

function finishMissionRecord(success = true) {
    if (appState.currentMissionId === null || !appState.missionStartTime) return;

    const now = new Date();
    const endCell = el(`m-end-${appState.currentMissionId}`);
    const durationCell = el(`m-duration-${appState.currentMissionId}`);
    const statusCell = el(`m-status-${appState.currentMissionId}`);

    if (endCell) {
        endCell.innerText = getTimeString(now);
        endCell.style.color = "var(--text-main)";
    }

    if (durationCell) {
        durationCell.innerText = formatDuration(now - appState.missionStartTime);
        durationCell.style.color = success ? "var(--text-main)" : "var(--color-red)";
    }

    if (statusCell) {
        statusCell.innerHTML = success
            ? `<span class="tag tag-succ">Hoàn thành</span>`
            : `<span class="tag tag-err">Lỗi</span>`;
    }

    appState.currentMissionId = null;
    appState.missionStartTime = null;
}

function failMissionRecord(reason = "Mất line") {
    if (appState.currentMissionId === null || !appState.missionStartTime) return;

    const now = new Date();
    const endCell = el(`m-end-${appState.currentMissionId}`);
    const durationCell = el(`m-duration-${appState.currentMissionId}`);
    const stepCell = el(`m-step-${appState.currentMissionId}`);
    const statusCell = el(`m-status-${appState.currentMissionId}`);

    if (endCell) {
        endCell.innerText = getTimeString(now);
        endCell.style.color = "var(--text-main)";
    }

    if (durationCell) {
        durationCell.innerText = formatDuration(now - appState.missionStartTime);
        durationCell.style.color = "var(--color-red)";
    }

    if (stepCell) {
        stepCell.innerText = reason;
    }

    if (statusCell) {
        statusCell.innerHTML = `<span class="tag tag-err">Lỗi</span>`;
    }

    printLog(`[MISSION] Mission lỗi: ${reason}`, "error");

    appState.currentMissionId = null;
    appState.missionStartTime = null;
}
/* =========================
   15. MISSION FLOW (AUTO ONLY)
========================= */
function setMissionStep(stepIndex) {
    if (appState.currentMode !== MODES.AUTO) return;

    if (appState.currentStep === stepIndex) return;

    const labels = [
        "Sẵn sàng",
        "Dò line tìm hàng",
        "Phát hiện hàng - Đang gắp",
        "Quay đầu về điểm thả",
        "Phát hiện điểm thả - Đang thả",
        "Hoàn thành",
    ];

    appState.currentStep = stepIndex;

    const stepName = labels[stepIndex] || "N/A";

    let logType = "info";
    if (stepIndex === STEP.PICKING || stepIndex === STEP.DROPPING) logType = "warn";
    if (stepIndex === STEP.DONE) logType = "success";

    printLog(`MISSION STEP → ${stepIndex} (${stepName})`, logType);

    // ===== Mission History =====
    if (stepIndex >= STEP.FIND_ITEM && appState.currentMissionId === null) {
        createMissionRecord();
    }

    updateMissionRecordStep(stepIndex, stepName);

    if (stepIndex === STEP.DONE) {
        finishMissionRecord(true);
    }

    const statusObj = el("missionStatus");

    if (statusObj) {
        statusObj.innerText = stepName;
        statusObj.classList.remove("moving-status", "done-status", "ready-status");

        if (stepIndex >= 1 && stepIndex <= 4) {
            statusObj.classList.add("moving-status");
        } else if (stepIndex === STEP.DONE) {
            statusObj.classList.add("done-status");
        } else if (stepIndex === STEP.READY) {
            statusObj.classList.add("ready-status");
        }
    }

    for (let i = 0; i <= 5; i++) {
        const step = el(`step${i}`);
        if (!step) continue;

        step.classList.remove("active", "done");

        if (i < stepIndex) {
            step.classList.add("done");
        } else if (i === stepIndex) {
            step.classList.add("active");
        }
    }

    for (let i = 0; i <= 4; i++) {
        const line = el(`line${i}`);
        if (!line) continue;

        line.classList.remove("done");
        if (i < stepIndex) {
            line.classList.add("done");
        }
    }
}
function handleWMSRecord(step) {
    if (appState.currentMode !== MODES.AUTO) return;

    if (step === STEP.FIND_ITEM) {
        createWMSRecord("AUTO");
    }

    if (step === STEP.PICKING) {
        if (appState.currentWMSId === null) {
            createWMSRecord("AUTO");
        }
        markWMSPicked();
    }

    if (step === STEP.DONE) {
        if (appState.currentWMSId !== null && appState.activePickupTime) {
            markWMSDropped();
        }

        printLog("AUTO: Hoàn thành 1 chu trình, tiếp tục chạy vòng lặp.", "success");

        setTimeout(() => {
            if (appState.currentMode === MODES.AUTO && appState.isAutoRunning) {
                setMissionStep(STEP.READY);
            }
        }, 1000);
    }
}

/* =========================
   16. ALERT / LINE LOST
========================= */
function showAlert() {
    clearAutoTimer();
    appState.isAutoRunning = false;
    appState.lastMoveDirection = "S";
    setDriveEnabled(false);
    stopAllMotion();
    failMissionRecord("Mất line");
    const alertBox = el("lineAlert");
    if (alertBox) alertBox.style.display = "flex";

    printLog("CRITICAL ERROR: Xe bị mất line!", "error");
}

function dismissAlert() {
    clearLineLostOverlay();
    stopAllMotion();
    setDriveEnabled(false);
    setMode(MODES.MANUAL);
}

/* =========================
   17. HANDLE REALTIME VALUES
========================= */
function handleEraValues(values) {
    const stepVal = getRealtimeValue(values, eraRealtimeConfigs.missionStep);
    if (stepVal !== undefined) {
        const step = parseInt(stepVal, 10);
        if (!Number.isNaN(step)) {
            if (step === STEP.LINE_LOST) {
                showAlert();
                return;
            }

            if (appState.currentMode === MODES.AUTO) {
                setMissionStep(step);
                handleWMSRecord(step);
            }
        }
    }

    const emergencyVal = getRealtimeValue(values, eraRealtimeConfigs.emergencyState);
    if (emergencyVal !== undefined) {
        const isEmergency = String(emergencyVal) === "1" || String(emergencyVal).toLowerCase() === "true";

        if (isEmergency && appState.currentMode !== MODES.EMERGENCY) {
            triggerEmergency(false);
        }

        if (!isEmergency && appState.currentMode === MODES.EMERGENCY) {
            resetFromEmergency(false);
        }
    }

    const totalCountVal = getRealtimeValue(values, eraRealtimeConfigs.totalCount);
    if (totalCountVal !== undefined) {
        const count = parseInt(totalCountVal, 10);
        if (!Number.isNaN(count)) {
            appState.packageCount = count;
            updateTotalCountUI();
        }
    }
}
/* =========================
   18. EXPORT
========================= */
function exportWMS() {
    const table = el("wmsTable");
    if (!table) {
        printLog("Không tìm thấy bảng WMS để export.", "error");
        return;
    }

    const rows = table.querySelectorAll("tr");
    let csv = "\uFEFF";

    rows.forEach((row) => {
        const cols = row.querySelectorAll("td, th");
        const rowData = Array.from(cols).map((col) => `"${col.innerText.trim()}"`);
        csv += `${rowData.join(",")}\n`;
    });

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = `AGV_WMS_Export_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();

    URL.revokeObjectURL(url);
    printLog("Đã export dữ liệu WMS ra CSV.", "success");
}
function exportMissionHistoryCSV() {
    const table = el("missionTable");
    if (!table) {
        printLog("Không tìm thấy bảng Mission History để export.", "error");
        return;
    }

    const rows = table.querySelectorAll("tr");
    let csv = "\uFEFF";

    rows.forEach((row) => {
        const cols = row.querySelectorAll("td, th");
        const rowData = Array.from(cols).map((col) => `"${col.innerText.trim()}"`);
        csv += `${rowData.join(",")}\n`;
    });

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = `Mission_History_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();

    URL.revokeObjectURL(url);
    printLog("Đã export Mission History ra CSV.", "success");
}
/* =========================
   19. OPTIONAL GLOBALS
========================= */
window.setMode = setMode;
window.move = move;
window.resetArm = resetArm;
window.manualPick = manualPick;
window.manualDrop = manualDrop;
window.dismissAlert = dismissAlert;
window.syncFromNum = syncFromNum;
window.syncFromRange = syncFromRange;
window.sendArmCommand = sendArmCommand;
window.exportWMS = exportWMS;
window.triggerEmergency = triggerEmergency;
window.resetFromEmergency = resetFromEmergency;
window.showAlert = showAlert;
window.exportMissionHistoryCSV = exportMissionHistoryCSV;
