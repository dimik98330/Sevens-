"use client";

import { useState } from "react";
import { useTranslation } from "@/features/i18n/provider";

// Настройка источника данных. Mock — только для разработки/тестов, пока B
// монтирует /api/v1 идей; перед выпуском production-сценарий идёт в настоящий backend (03 §9).
export default function SettingsPage() {
  const { t: tr, intlLocale } = useTranslation();
  const [base, setBase] = useState(() => (typeof window === "undefined" ? "" : (sessionStorage.getItem("abai.apiBase") ?? "")));
  const [mode, setMode] = useState(() => (typeof window === "undefined" ? "1" : (sessionStorage.getItem("abai.useMock") ?? "1")));

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const b = base.trim().replace(/\/$/, "");
    if (b) sessionStorage.setItem("abai.apiBase", b);
    else sessionStorage.removeItem("abai.apiBase");
    sessionStorage.setItem("abai.useMock", mode);
    window.location.href = "/";
  };

  return (
    <div className="narrow">
      <div className="card">
        <h1>{tr("Настройка backend")}</h1>
        <p className="muted">
          {tr(" Mock используется только для разработки/тестов, пока API идей B не смонтировано. Перед выпуском подключите настоящий backend. ")}</p>
        <form onSubmit={save}>
          <div className="field">
            <label htmlFor="apiBase">{tr("Base URL настоящего backend (пусто = same-origin /api/v1)")}</label>
            <input id="apiBase" type="text" value={base} onChange={(e) => setBase(e.target.value)} placeholder="https://backend.example.test" />
          </div>
          <div className="field">
            <label htmlFor="mock">{tr("Режим данных")}</label>
            <select id="mock" value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="1">{tr("Демо-mock по контракту (разработка)")}</option>
              <option value="0">{tr("Настоящий backend")}</option>
            </select>
          </div>
          <button className="btn btn-primary" type="submit">
            {tr(" Сохранить ")}</button>
        </form>
      </div>
    </div>
  );
}
