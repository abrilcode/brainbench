"""Focus and relaxation scores from BrainFlow's built-in classifiers.

BrainFlow's MLModel turns average band powers (mean and spread across the
EEG channels) into a score from 0 to 1: MINDFULNESS for concentration and
RESTFULNESS for relaxation. These are the models the OpenBCI GUI uses.
"""

from __future__ import annotations

import numpy as np

try:
    from brainflow.data_filter import DataFilter
    from brainflow.ml_model import BrainFlowClassifiers, BrainFlowMetrics, BrainFlowModelParams, MLModel
except ImportError:  # pragma: no cover
    MLModel = None

METRICS = {"concentration": "MINDFULNESS", "relaxation": "RESTFULNESS"}


class FocusModel:
    def __init__(self):
        self.available = MLModel is not None
        self._models: dict[str, "MLModel"] = {}

    def _model(self, metric: str):
        if metric not in self._models:
            m = getattr(BrainFlowMetrics, METRICS[metric])
            params = BrainFlowModelParams(m.value, BrainFlowClassifiers.DEFAULT_CLASSIFIER.value)
            model = MLModel(params)
            model.prepare()
            self._models[metric] = model
        return self._models[metric]

    def predict(self, data: np.ndarray, layout, metric: str = "concentration", channels: list[int] | None = None) -> dict:
        """Score for the last seconds of raw data; None until there are 2 s of it.

        ``channels`` are EXG channel indices (0-based); all channels by default.
        """
        if metric not in METRICS:
            raise ValueError(f"metric must be one of {sorted(METRICS)}")
        if not self.available or layout is None or data.shape[1] < 2 * layout.sampling_rate:
            return {"metric": metric, "value": None}
        rows = [layout.eeg[i] for i in (channels if channels else range(len(layout.eeg))) if 0 <= i < len(layout.eeg)]
        if not rows:
            return {"metric": metric, "value": None}
        channels = rows
        bands = DataFilter.get_avg_band_powers(np.ascontiguousarray(data), channels, layout.sampling_rate, True)
        features = np.asarray(bands[0])  # BrainFlow 5 models take the five average band powers
        value = float(self._model(metric).predict(features)[0])
        return {"metric": metric, "value": value, "bands": [float(b) for b in bands[0]]}

    def close(self) -> None:
        for m in self._models.values():
            m.release()
        self._models.clear()
