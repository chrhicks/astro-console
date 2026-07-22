const scenarioSelect = document.querySelector("[data-scenario-select]")

if (scenarioSelect instanceof HTMLSelectElement) {
  const applyScenario = () => {
    document.body.dataset.scenario = scenarioSelect.value
    document.querySelectorAll("[data-scenario-label]").forEach((element) => {
      element.textContent = scenarioSelect.selectedOptions[0]?.textContent ?? "Scenario"
    })
  }

  scenarioSelect.addEventListener("change", applyScenario)
  applyScenario()
}

document.querySelectorAll("[data-select-row]").forEach((element) => {
  const select = () => {
    const group = element.closest("[data-select-group]")
    group?.querySelectorAll(".selected, .active").forEach((selected) => {
      selected.classList.remove("selected", "active")
      if (selected.hasAttribute("aria-selected")) selected.setAttribute("aria-selected", "false")
    })
    element.classList.add(element.matches("tr") ? "selected" : "active")
    if (element.hasAttribute("aria-selected")) element.setAttribute("aria-selected", "true")

    const detail = document.querySelector("[data-selection-detail]")
    const name = element.getAttribute("data-name")
    if (detail && name) detail.textContent = name
  }

  element.addEventListener("click", select)
  element.addEventListener("keydown", (event) => {
    if (event.target !== element) return
    if (event.key !== "Enter" && event.key !== " ") return
    event.preventDefault()
    select()
  })
})

document.querySelectorAll("[data-dialog-open]").forEach((button) => {
  button.addEventListener("click", () => {
    const dialog = document.getElementById(button.getAttribute("data-dialog-open") ?? "")
    if (dialog instanceof HTMLDialogElement) dialog.showModal()
  })
})

document.querySelectorAll("[data-dialog-close]").forEach((button) => {
  button.addEventListener("click", () => {
    const dialog = button.closest("dialog")
    if (dialog instanceof HTMLDialogElement) dialog.close()
  })
})

document.querySelectorAll("dialog").forEach((dialog) => {
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close()
  })
})

document.querySelectorAll("[data-prototype-action]").forEach((button) => {
  button.addEventListener("click", () => {
    const message = document.querySelector("[data-action-message]")
    if (!message) return

    message.textContent = `${button.getAttribute("data-prototype-action")} — simulated only; no command was sent.`
    message.removeAttribute("hidden")
  })
})
