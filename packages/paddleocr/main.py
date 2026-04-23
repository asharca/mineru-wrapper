#!/usr/bin/env python3
"""PaddleOCR-based document orientation detection service."""

import io
import json
import os
import tempfile
from typing import List

import cv2
import numpy as np
from fastapi import FastAPI, File, UploadFile
from fastapi.responses import JSONResponse
from paddleocr import PaddleOCR

app = FastAPI(title="PaddleOCR Direction Detection", version="1.0.0")

# Initialize PaddleOCR once at startup (loads models on first use)
ocr = PaddleOCR(
    use_angle_cls=True,
    lang="ch",
    show_log=False,
    use_gpu=False,
)

ROTATION_CANDIDATES = [0, 90, 180, 270]


def rotate_image(image: np.ndarray, angle: int) -> np.ndarray:
    if angle == 0:
        return image
    elif angle == 90:
        return cv2.rotate(image, cv2.ROTATE_90_CLOCKWISE)
    elif angle == 180:
        return cv2.rotate(image, cv2.ROTATE_180)
    else:  # 270
        return cv2.rotate(image, cv2.ROTATE_90_COUNTERCLOCKWISE)


def detect_best_angle(image: np.ndarray) -> int:
    best_angle = 0
    best_score = -1.0
    pid = os.getpid()

    for angle in ROTATION_CANDIDATES:
        rotated = rotate_image(image, angle)

        tmp_path = f"/tmp/paddle_rot_{pid}_{angle}.jpg"
        cv2.imwrite(tmp_path, rotated)

        try:
            result = ocr.ocr(tmp_path, cls=True)
            if result and result[0]:
                boxes = result[0]
                total_conf = sum(float(box[1][1]) for box in boxes)
                text_len = sum(len(str(box[1][0])) for box in boxes)
                score = total_conf + text_len * 0.5
                if score > best_score:
                    best_score = score
                    best_angle = angle
        except Exception:
            pass
        finally:
            try:
                os.remove(tmp_path)
            except Exception:
                pass

    return best_angle


@app.post("/detect")
async def detect(files: List[UploadFile] = File(...)):
    """
    Detect best rotation angle (0/90/180/270) for each uploaded image.
    Returns angles in the same order as the uploaded files.
    """
    angles: List[int] = []

    for upload in files:
        content = await upload.read()
        nparr = np.frombuffer(content, np.uint8)
        image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        if image is None:
            angles.append(0)
            continue

        angle = detect_best_angle(image)
        angles.append(angle)

    return {"angles": angles}


@app.get("/health")
async def health():
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run(app, host="0.0.0.0", port=port)
