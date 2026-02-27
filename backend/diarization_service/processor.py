"""Audio processing service that performs diarization and merges with transcripts.

This processor runs pyannote diarization on audio files and assigns speaker labels
to existing transcript segments based on time overlap. Unlike the PR's version,
this does NOT include a whisper client - transcription is handled by the Rust
frontend's whisper engine. This processor is for post-hoc speaker assignment.
"""
from __future__ import annotations

import os
import logging
from typing import List, Dict, Any, Optional

from .config import DiarizationConfig
from .audio_utils import AudioConverter
from .diarization import DiarizationEngine, DiarizationSegment, DiarizationResult
from .whisper_client import WhisperClient
from .speaker_tracker import SpeakerTracker
from .speaker_tracker import SpeakerTracker

logger = logging.getLogger(__name__)


class AudioProcessor:
    """
    Orchestrates diarization and speaker tracking.

    Workflow:
    1. Receive audio file path and existing transcript segments
    2. Run pyannote for speaker diarization
    3. Use speaker tracker for consistent IDs across chunks (if session_id provided)
    4. Merge diarization results with transcript segments by time overlap
    5. Return segments with speaker labels
    """

    def __init__(self, config: DiarizationConfig):
        """
        Initialize the audio processor.

        Args:
            config: Configuration object with settings
        """
        self.config = config
        self.audio_converter = AudioConverter()

        # Initialize diarization pipeline (lazy-loaded)
        self.diarization_engine = DiarizationEngine(
            pipeline_name=config.diarization_pipeline_name,
            auth_token=config.hf_auth_token,
            device=config.device_str
        )

        # Initialize speaker tracker for cross-chunk consistency
        persist_dir = config.speaker_embedding_dir if config.speaker_embedding_dir else None
        self.speaker_tracker = SpeakerTracker(
            auth_token=config.hf_auth_token,
            device=config.device_str,
            persist_dir=persist_dir
        )

        logger.info("AudioProcessor initialized")
        logger.info(f"  Diarization model: {config.diarization_pipeline_name}")
        logger.info(f"  Speaker tracking available: {self.speaker_tracker.is_available}")
        logger.info(f"  Device: {config.device_str}")

    @property
    def diarization_available(self) -> bool:
        """Check if diarization pipeline is loaded."""
        return self.diarization_engine.is_available

    @property
    def speaker_tracking_available(self) -> bool:
        """Check if speaker tracking embeddings are available."""
        return self.speaker_tracker.is_available


    @property
    def is_model_loaded(self) -> bool:
        """Check if diarization model is loaded."""
        return self.diarization_engine.is_available
    
    @property
    def device(self) -> str:
        """Get the device being used for diarization."""
        return self.config.device_str
    
    async def check_model_status(self):
        """Check the status of loaded diarization models."""
        if not self.diarization_engine.is_available:
            return None
        
        class ModelInfo:
            def __init__(self, name, device):
                self.name = name
                self.device = device
                self.loaded = True
        
        return ModelInfo(
            name=self.config.diarization_pipeline_name,
            device=self.config.device_str
        )

    async def load_model(self) -> bool:
        """Load the diarization model."""
        # Model is loaded at initialization, so just check if it's available
        return self.diarization_engine.is_available
    
    def unload_model(self):
        """Unload the diarization model."""
        # For now, model lifecycle is managed at the service level
        # This is a no-op for compatibility
        pass
    
    async def diarize_audio_with_tracking(
        self,
        audio_path: str,
        session_id: str,
        min_speakers: Optional[int] = None,
        max_speakers: Optional[int] = None
    ):
        """Diarize audio with cross-chunk speaker tracking."""
        return await self.diarize_audio(
            audio_path=audio_path,
            min_speakers=min_speakers,
            max_speakers=max_speakers,
            session_id=session_id
        )
    async def diarize_audio(
        self,
        audio_path: str,
        min_speakers: Optional[int] = None,
        max_speakers: Optional[int] = None,
        session_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Run speaker diarization on an audio file.

        Args:
            audio_path: Path to the audio file
            min_speakers: Optional minimum speaker count hint
            max_speakers: Optional maximum speaker count hint
            session_id: Optional session/meeting ID for cross-chunk speaker tracking

        Returns:
            DiarizationResult with speaker segments
        """
        if not os.path.exists(audio_path):
            raise FileNotFoundError(f"Audio file not found: {audio_path}")

        temp_wav_path: Optional[str] = None

        try:
            # Convert audio to WAV format for pyannote (16kHz mono)
            base, ext = os.path.splitext(audio_path)
            if ext.lower() != ".wav":
                temp_wav_path = f"{base}_diarization.wav"
                conversion_success = self.audio_converter.convert_to_wav(
                    input_path=audio_path,
                    output_path=temp_wav_path,
                    sample_rate=self.config.audio_convert_sample_rate,
                    channels=self.config.audio_convert_channels
                )
                if not conversion_success:
                    raise RuntimeError(f"Audio conversion failed for {audio_path}")
                wav_path = temp_wav_path
            else:
                wav_path = audio_path

            # Run diarization
            result = await self.diarization_engine.get_speaker_turns(
                wav_path,
                min_speakers=min_speakers,
                max_speakers=max_speakers
            )

            # Apply cross-chunk speaker tracking if session_id given
            if session_id and self.speaker_tracker.is_available and result.segments:
                logger.info(f"Applying speaker tracking for session {session_id}")
                turns = [
                    {"speaker": s.speaker_id, "start": s.start_time, "end": s.end_time}
                    for s in result.segments
                ]
                tracked_turns = self.speaker_tracker.assign_speakers(
                    session_id=session_id,
                    audio_path=wav_path,
                    diarization_turns=turns,
                    num_speakers=max_speakers
                )
                # Rebuild result with tracked speaker IDs
                result.segments = [
                    DiarizationSegment(
                        speaker_id=t["speaker"],
                        start_time=t["start"],
                        end_time=t["end"]
                    )
                    for t in tracked_turns
                ]
                speakers_seen = set(s.speaker_id for s in result.segments)
                result.num_speakers = len(speakers_seen)

            return result

        finally:
            # Cleanup temp WAV file
            if temp_wav_path:
                self.audio_converter.cleanup_temp_file(temp_wav_path)

    def assign_speakers_to_transcripts(
        self,
        diarization_result: DiarizationResult,
        transcripts: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """
        Assign speaker labels to transcript segments based on time overlap.

        Uses maximum time overlap to match each transcript segment to the
        speaker who spoke the most during that segment's time range.

        Args:
            diarization_result: Diarization output with speaker segments
            transcripts: Transcript segments with audio_start_time/audio_end_time

        Returns:
            Updated transcript list with speaker_id and speaker_label fields
        """
        if not diarization_result.segments:
            logger.info("No diarization segments, marking all transcripts as UNKNOWN")
            return [
                {**t, "speaker_id": "UNKNOWN", "speaker_label": "Unknown"}
                for t in transcripts
            ]

        updated = []
        for transcript in transcripts:
            t_start = transcript.get("audio_start_time", 0.0) or 0.0
            t_end = transcript.get("audio_end_time", 0.0) or 0.0

            best_speaker = "UNKNOWN"
            max_overlap = 0.0

            # Find the speaker with maximum time overlap
            for seg in diarization_result.segments:
                overlap_start = max(t_start, seg.start_time)
                overlap_end = min(t_end, seg.end_time)
                overlap_duration = max(0.0, overlap_end - overlap_start)

                if overlap_duration > max_overlap:
                    max_overlap = overlap_duration
                    best_speaker = seg.speaker_id

            # Generate a human-readable label from the speaker ID
            speaker_num = best_speaker.split("_")[-1] if "_" in best_speaker else "0"
            try:
                speaker_label = f"Speaker {int(speaker_num) + 1}"
            except ValueError:
                speaker_label = best_speaker

            updated.append({
                **transcript,
                "speaker_id": best_speaker,
                "speaker_label": speaker_label
            })

        return updated

    def get_session_speakers(self, session_id: str) -> List[Dict[str, Any]]:
        """Get summary of speakers in a session."""
        return self.speaker_tracker.get_session_speakers(session_id)

    def clear_session(self, session_id: str):
        """Clear a session's speaker tracking data."""
        self.speaker_tracker.clear_session(session_id)
