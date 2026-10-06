"use client";

import type { InputDevice } from "@/lib/audio/useMicrophone";

interface DevicePickerProps {
  devices: InputDevice[];
  labelsHidden: boolean;
  value: string;
  activeLabel: string | null;
  onChange: (deviceId: string) => void;
}

export function DevicePicker({ devices, labelsHidden, value, activeLabel, onChange }: DevicePickerProps) {
  const valueListed = value === "" || devices.some((d) => d.deviceId === value);
  const savedMissing = !valueListed && !labelsHidden;

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label
        htmlFor="input-device"
        className="text-[11px] font-semibold uppercase tracking-widest text-neutral-500"
      >
        Input device
      </label>
      <select
        id="input-device"
        value={value}
        // The select hands the keyboard back as soon as a device is chosen. It
        // is one of two things on the live screen that can hold focus, and
        // while it does, X does not take a card down.
        onChange={(e) => {
          e.target.blur();
          onChange(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") e.currentTarget.blur();
        }}
        className="h-10 w-80 max-w-full truncate rounded-md border border-neutral-300 bg-neutral-50 px-3 text-sm text-neutral-900 focus:border-neutral-600 focus:outline-none"
      >
        <option value="">Browser default</option>
        {!valueListed && (
          <option value={value}>{labelsHidden ? "Saved device" : "Saved device (not connected)"}</option>
        )}
        {devices.map((d) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label}
          </option>
        ))}
      </select>
      <p className="h-4 max-w-80 truncate text-xs text-neutral-500">
        {savedMissing ? (
          <span className="text-amber-600">Saved device not found. Plug it in or pick another.</span>
        ) : activeLabel ? (
          <>
            Capturing: <span className="text-neutral-700">{activeLabel}</span>
          </>
        ) : labelsHidden ? (
          "Turn the mic on once to see device names"
        ) : (
          " "
        )}
      </p>
    </div>
  );
}
