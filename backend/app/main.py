import sys
from pathlib import Path
import os

# Add parent directory (backend/) to Python path so we can import diarization_service
# When running as `python app\main.py`, __file__ is relative, so resolve to absolute first
backend_dir = Path(__file__).resolve().parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import uvicorn
from typing import Optional, List
import logging
from dotenv import load_dotenv
from db import DatabaseManager
import json
from threading import Lock
from transcript_processor import TranscriptProcessor
import time

# Load environment variables
load_dotenv()

# Configure logger with line numbers and function names
logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)

# Create console handler with formatting
console_handler = logging.StreamHandler()
console_handler.setLevel(logging.DEBUG)

# Create formatter with line numbers and function names
formatter = logging.Formatter(
    '%(asctime)s - %(levelname)s - [%(filename)s:%(lineno)d - %(funcName)s()] - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
console_handler.setFormatter(formatter)

# Add handler to logger if not already added
if not logger.handlers:
    logger.addHandler(console_handler)

app = FastAPI(
    title="Meeting Summarizer API",
    description="API for processing and summarizing meeting transcripts",
    version="1.0.0"
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],     # Allow all origins for testing
    allow_credentials=True,
    allow_methods=["*"],     # Allow all methods
    allow_headers=["*"],     # Allow all headers
    max_age=3600,            # Cache preflight requests for 1 hour
)

# Global database manager instance for meeting management endpoints
db = DatabaseManager()

# New Pydantic models for meeting management
class Transcript(BaseModel):
    id: str
    text: str
    timestamp: str
    # Recording-relative timestamps for audio-transcript synchronization
    audio_start_time: Optional[float] = None
    audio_end_time: Optional[float] = None
    duration: Optional[float] = None
    # Speaker diarization fields
    speaker_id: Optional[str] = None
    speaker_label: Optional[str] = None

class MeetingResponse(BaseModel):
    id: str
    title: str

class MeetingDetailsResponse(BaseModel):
    id: str
    title: str
    created_at: str
    updated_at: str
    transcripts: List[Transcript]

class MeetingTitleUpdate(BaseModel):
    meeting_id: str
    title: str

class DeleteMeetingRequest(BaseModel):
    meeting_id: str

class SaveTranscriptRequest(BaseModel):
    meeting_title: str
    transcripts: List[Transcript]
    folder_path: Optional[str] = None  # NEW: Path to meeting folder (for new folder structure)

class SaveModelConfigRequest(BaseModel):
    provider: str
    model: str
    whisperModel: str
    apiKey: Optional[str] = None

class SaveTranscriptConfigRequest(BaseModel):
    provider: str
    model: str
    apiKey: Optional[str] = None

class TranscriptRequest(BaseModel):
    """Request model for transcript text, updated with meeting_id"""
    text: str
    model: str
    model_name: str
    meeting_id: str
    chunk_size: Optional[int] = 5000
    overlap: Optional[int] = 1000
    custom_prompt: Optional[str] = "Generate a summary of the meeting transcript."

class SummaryProcessor:
    """Handles the processing of summaries in a thread-safe way"""
    def __init__(self):
        try:
            self.db = DatabaseManager()

            logger.info("Initializing SummaryProcessor components")
            self.transcript_processor = TranscriptProcessor()
            logger.info("SummaryProcessor initialized successfully (core components)")
        except Exception as e:
            logger.error(f"Failed to initialize SummaryProcessor: {str(e)}", exc_info=True)
            raise

    async def process_transcript(self, text: str, model: str, model_name: str, chunk_size: int = 5000, overlap: int = 1000, custom_prompt: str = "Generate a summary of the meeting transcript.") -> tuple:
        """Process a transcript text"""
        try:
            if not text:
                raise ValueError("Empty transcript text provided")

            # Validate chunk_size and overlap
            if chunk_size <= 0:
                raise ValueError("chunk_size must be positive")
            if overlap < 0:
                raise ValueError("overlap must be non-negative")
            if overlap >= chunk_size:
                overlap = chunk_size - 1  # Ensure overlap is less than chunk_size

            # Ensure step size is positive
            step_size = chunk_size - overlap
            if step_size <= 0:
                chunk_size = overlap + 1  # Adjust chunk_size to ensure positive step

            logger.info(f"Processing transcript of length {len(text)} with chunk_size={chunk_size}, overlap={overlap}")
            num_chunks, all_json_data = await self.transcript_processor.process_transcript(
                text=text,
                model=model,
                model_name=model_name,
                chunk_size=chunk_size,
                overlap=overlap,
                custom_prompt=custom_prompt
            )
            logger.info(f"Successfully processed transcript into {num_chunks} chunks")

            return num_chunks, all_json_data
        except Exception as e:
            logger.error(f"Error processing transcript: {str(e)}", exc_info=True)
            raise

    def cleanup(self):
        """Cleanup resources"""
        try:
            logger.info("Cleaning up resources")
            if hasattr(self, 'transcript_processor'):
                self.transcript_processor.cleanup()
            logger.info("Cleanup completed successfully")
        except Exception as e:
            logger.error(f"Error during cleanup: {str(e)}", exc_info=True)

# Initialize processor
processor = SummaryProcessor()

# New meeting management endpoints
@app.get("/get-meetings", response_model=List[MeetingResponse])
async def get_meetings():
    """Get all meetings with their basic information"""
    try:
        meetings = await db.get_all_meetings()
        return [{"id": meeting["id"], "title": meeting["title"]} for meeting in meetings]
    except Exception as e:
        logger.error(f"Error getting meetings: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/get-meeting/{meeting_id}", response_model=MeetingDetailsResponse)
async def get_meeting(meeting_id: str):
    """Get a specific meeting by ID with all its details"""
    try:
        meeting = await db.get_meeting(meeting_id)
        if not meeting:
            raise HTTPException(status_code=404, detail="Meeting not found")
        return meeting
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting meeting: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/save-meeting-title")
async def save_meeting_title(data: MeetingTitleUpdate):
    """Save a meeting title"""
    try:
        await db.update_meeting_title(data.meeting_id, data.title)
        return {"message": "Meeting title saved successfully"}
    except Exception as e:
        logger.error(f"Error saving meeting title: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/delete-meeting")
async def delete_meeting(data: DeleteMeetingRequest):
    """Delete a meeting and all its associated data"""
    try:
        success = await db.delete_meeting(data.meeting_id)
        if success:
            return {"message": "Meeting deleted successfully"}
        else:
            raise HTTPException(status_code=500, detail="Failed to delete meeting")
    except Exception as e:
        logger.error(f"Error deleting meeting: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

async def process_transcript_background(process_id: str, transcript: TranscriptRequest, custom_prompt: str):
    """Background task to process transcript"""
    try:
        logger.info(f"Starting background processing for process_id: {process_id}")
        
        # Early validation for common issues
        if not transcript.text or not transcript.text.strip():
            raise ValueError("Empty transcript text provided")
        
        if transcript.model in ["claude", "groq", "openai"]:
            # Check if API key is available for cloud providers
            api_key = await processor.db.get_api_key(transcript.model)
            if not api_key:
                provider_names = {"claude": "Anthropic", "groq": "Groq", "openai": "OpenAI"}
                raise ValueError(f"{provider_names.get(transcript.model, transcript.model)} API key not configured. Please set your API key in the model settings.")

        _, all_json_data = await processor.process_transcript(
            text=transcript.text,
            model=transcript.model,
            model_name=transcript.model_name,
            chunk_size=transcript.chunk_size,
            overlap=transcript.overlap,
            custom_prompt=custom_prompt
        )

        # Create final summary structure by aggregating chunk results
        final_summary = {
            "MeetingName": "",
            "People": {"title": "People", "blocks": []},
            "SessionSummary": {"title": "Session Summary", "blocks": []},
            "CriticalDeadlines": {"title": "Critical Deadlines", "blocks": []},
            "KeyItemsDecisions": {"title": "Key Items & Decisions", "blocks": []},
            "ImmediateActionItems": {"title": "Immediate Action Items", "blocks": []},
            "NextSteps": {"title": "Next Steps", "blocks": []},
            # "OtherImportantPoints": {"title": "Other Important Points", "blocks": []},
            # "ClosingRemarks": {"title": "Closing Remarks", "blocks": []},
            "MeetingNotes": {
                "meeting_name": "",
                "sections": []
            }
        }

        # Process each chunk's data
        for json_str in all_json_data:
            try:
                json_dict = json.loads(json_str)
                if "MeetingName" in json_dict and json_dict["MeetingName"]:
                    final_summary["MeetingName"] = json_dict["MeetingName"]
                for key in final_summary:
                    if key == "MeetingNotes" and key in json_dict:
                        # Handle MeetingNotes sections
                        if isinstance(json_dict[key].get("sections"), list):
                            # Ensure each section has blocks array
                            for section in json_dict[key]["sections"]:
                                if not section.get("blocks"):
                                    section["blocks"] = []
                            final_summary[key]["sections"].extend(json_dict[key]["sections"])
                        if json_dict[key].get("meeting_name"):
                            final_summary[key]["meeting_name"] = json_dict[key]["meeting_name"]
                    elif key != "MeetingName" and key in json_dict and isinstance(json_dict[key], dict) and "blocks" in json_dict[key]:
                        if isinstance(json_dict[key]["blocks"], list):
                            final_summary[key]["blocks"].extend(json_dict[key]["blocks"])
                            # Also add as a new section in MeetingNotes if not already present
                            section_exists = False
                            for section in final_summary["MeetingNotes"]["sections"]:
                                if section["title"] == json_dict[key]["title"]:
                                    section["blocks"].extend(json_dict[key]["blocks"])
                                    section_exists = True
                                    break
                            
                            if not section_exists:
                                final_summary["MeetingNotes"]["sections"].append({
                                    "title": json_dict[key]["title"],
                                    "blocks": json_dict[key]["blocks"].copy() if json_dict[key]["blocks"] else []
                                })
            except json.JSONDecodeError as e:
                logger.error(f"Failed to parse JSON chunk for {process_id}: {e}. Chunk: {json_str[:100]}...")
            except Exception as e:
                logger.error(f"Error processing chunk data for {process_id}: {e}. Chunk: {json_str[:100]}...")

        # Update database with meeting name using meeting_id
        if final_summary["MeetingName"]:
            await processor.db.update_meeting_name(transcript.meeting_id, final_summary["MeetingName"])

        # Save final result
        if all_json_data:
            await processor.db.update_process(process_id, status="completed", result=json.dumps(final_summary))
            logger.info(f"Background processing completed for process_id: {process_id}")
        else:
            error_msg = "Summary generation failed: No chunks were processed successfully. Check logs for specific errors."
            await processor.db.update_process(process_id, status="failed", error=error_msg)
            logger.error(f"Background processing failed for process_id: {process_id} - {error_msg}")

    except ValueError as e:
        # Handle specific value errors (like API key issues)
        error_msg = str(e)
        logger.error(f"Configuration error in background processing for {process_id}: {error_msg}", exc_info=True)
        try:
            await processor.db.update_process(process_id, status="failed", error=error_msg)
        except Exception as db_e:
            logger.error(f"Failed to update DB status to failed for {process_id}: {db_e}", exc_info=True)
    except Exception as e:
        # Handle all other exceptions
        error_msg = f"Processing error: {str(e)}"
        logger.error(f"Error in background processing for {process_id}: {error_msg}", exc_info=True)
        try:
            await processor.db.update_process(process_id, status="failed", error=error_msg)
        except Exception as db_e:
            logger.error(f"Failed to update DB status to failed for {process_id}: {db_e}", exc_info=True)

@app.post("/process-transcript")
async def process_transcript_api(
    transcript: TranscriptRequest,
    background_tasks: BackgroundTasks
):
    """Process a transcript text with background processing"""
    try:
        # Create new process linked to meeting_id
        process_id = await processor.db.create_process(transcript.meeting_id)

        # Save transcript data associated with meeting_id
        await processor.db.save_transcript(
            transcript.meeting_id,
            transcript.text,
            transcript.model,
            transcript.model_name,
            transcript.chunk_size,
            transcript.overlap
        )

        custom_prompt = transcript.custom_prompt

        # Start background processing
        background_tasks.add_task(
            process_transcript_background,
            process_id,
            transcript,
            custom_prompt
        )

        return JSONResponse({
            "message": "Processing started",
            "process_id": process_id
        })

    except Exception as e:
        logger.error(f"Error in process_transcript_api: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/get-summary/{meeting_id}")
async def get_summary(meeting_id: str):
    """Get the summary for a given meeting ID"""
    try:
        result = await processor.db.get_transcript_data(meeting_id)
        if not result:
            return JSONResponse(
                status_code=404,
                content={
                    "status": "error",
                    "meetingName": None,
                    "meeting_id": meeting_id,
                    "data": None,
                    "start": None,
                    "end": None,
                    "error": "Meeting ID not found"
                }
            )

        status = result.get("status", "unknown").lower()
        logger.debug(f"Summary status for meeting {meeting_id}: {status}, error: {result.get('error')}")

        # Parse result data if available
        summary_data = None
        if result.get("result"):
            try:
                parsed_result = json.loads(result["result"])
                if isinstance(parsed_result, str):
                    summary_data = json.loads(parsed_result)
                else:
                    summary_data = parsed_result
                if not isinstance(summary_data, dict):
                    logger.error(f"Parsed summary data is not a dictionary for meeting {meeting_id}")
                    summary_data = None
            except json.JSONDecodeError as e:
                logger.error(f"Failed to parse JSON data for meeting {meeting_id}: {str(e)}")
                status = "failed"
                result["error"] = f"Invalid summary data format: {str(e)}"
            except Exception as e:
                logger.error(f"Unexpected error parsing summary data for {meeting_id}: {str(e)}")
                status = "failed"
                result["error"] = f"Error processing summary data: {str(e)}"

        # Transform summary data into frontend format if available - PRESERVE ORDER
        transformed_data = {}
        if isinstance(summary_data, dict) and status == "completed":
            # Add MeetingName to transformed data
            transformed_data["MeetingName"] = summary_data.get("MeetingName", "")

            # Map backend sections to frontend sections
            section_mapping = {
                # "SessionSummary": "key_points",
                # "ImmediateActionItems": "action_items",
                # "KeyItemsDecisions": "decisions",
                # "NextSteps": "next_steps",
                # "CriticalDeadlines": "critical_deadlines",
                # "People": "people"
            }

            # Add each section to transformed data
            for backend_key, frontend_key in section_mapping.items():
                if backend_key in summary_data and isinstance(summary_data[backend_key], dict):
                    transformed_data[frontend_key] = summary_data[backend_key]
            
            # Add meeting notes sections if available - PRESERVE ORDER AND HANDLE DUPLICATES
            if "MeetingNotes" in summary_data and isinstance(summary_data["MeetingNotes"], dict):
                meeting_notes = summary_data["MeetingNotes"]
                if isinstance(meeting_notes.get("sections"), list):
                    # Add section order array to maintain order
                    transformed_data["_section_order"] = []
                    used_keys = set()
                    
                    for index, section in enumerate(meeting_notes["sections"]):
                        if isinstance(section, dict) and "title" in section and "blocks" in section:
                            # Ensure blocks is a list to prevent frontend errors
                            if not isinstance(section.get("blocks"), list):
                                section["blocks"] = []
                                
                            # Convert title to snake_case key
                            base_key = section["title"].lower().replace(" & ", "_").replace(" ", "_")
                            
                            # Handle duplicate section names by adding index
                            key = base_key
                            if key in used_keys:
                                key = f"{base_key}_{index}"
                            
                            used_keys.add(key)
                            transformed_data[key] = section
                            # Only add to _section_order if the section was successfully added
                            transformed_data["_section_order"].append(key)

        response = {
            "status": "processing" if status in ["processing", "pending", "started"] else status,
            "meetingName": summary_data.get("MeetingName") if isinstance(summary_data, dict) else None,
            "meeting_id": meeting_id,
            "start": result.get("start_time"),
            "end": result.get("end_time"),
            "data": transformed_data if status == "completed" else None
        }

        if status == "failed":
            response["status"] = "error"
            response["error"] = result.get("error", "Unknown processing error")
            response["data"] = None
            response["meetingName"] = None
            logger.info(f"Returning failed status with error: {response['error']}")
            return JSONResponse(status_code=400, content=response)

        elif status in ["processing", "pending", "started"]:
            response["data"] = None
            return JSONResponse(status_code=202, content=response)

        elif status == "completed":
            if not summary_data:
                response["status"] = "error"
                response["error"] = "Completed but summary data is missing or invalid"
                response["data"] = None
                response["meetingName"] = None
                return JSONResponse(status_code=500, content=response)
            return JSONResponse(status_code=200, content=response)

        else:
            response["status"] = "error"
            response["error"] = f"Unknown or unexpected status: {status}"
            response["data"] = None
            response["meetingName"] = None
            return JSONResponse(status_code=500, content=response)

    except Exception as e:
        logger.error(f"Error getting summary for {meeting_id}: {str(e)}", exc_info=True)
        return JSONResponse(
            status_code=500,
            content={
                "status": "error",
                "meetingName": None,
                "meeting_id": meeting_id,
                "data": None,
                "start": None,
                "end": None,
                "error": f"Internal server error: {str(e)}"
            }
        )

@app.post("/save-transcript")
async def save_transcript(request: SaveTranscriptRequest):
    """Save transcript segments for a meeting without processing"""
    try:
        logger.info(f"Received save-transcript request for meeting: {request.meeting_title}")
        logger.info(f"Number of transcripts to save: {len(request.transcripts)}")

        # Log first transcript timestamps for debugging
        if request.transcripts:
            first = request.transcripts[0]
            logger.debug(f"First transcript: audio_start_time={first.audio_start_time}, audio_end_time={first.audio_end_time}, duration={first.duration}")

        # Generate a unique meeting ID
        meeting_id = f"meeting-{int(time.time() * 1000)}"

        # Save the meeting with folder path (if provided)
        await db.save_meeting(meeting_id, request.meeting_title, folder_path=request.folder_path)

        # Save each transcript segment with timestamp fields and speaker info
        for transcript in request.transcripts:
            await db.save_meeting_transcript(
                meeting_id=meeting_id,
                transcript=transcript.text,
                timestamp=transcript.timestamp,
                summary="",
                action_items="",
                key_points="",
                audio_start_time=transcript.audio_start_time,
                audio_end_time=transcript.audio_end_time,
                duration=transcript.duration,
                speaker_id=transcript.speaker_id,
                speaker_label=transcript.speaker_label
            )

        logger.info("Transcripts saved successfully")
        return {"status": "success", "message": "Transcript saved successfully", "meeting_id": meeting_id}
    except Exception as e:
        logger.error(f"Error saving transcript: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/get-model-config")
async def get_model_config():
    """Get the current model configuration"""
    model_config = await db.get_model_config()
    if model_config:
        api_key = await db.get_api_key(model_config["provider"])
        if api_key != None:
            model_config["apiKey"] = api_key
    return model_config

@app.post("/save-model-config")
async def save_model_config(request: SaveModelConfigRequest):
    """Save the model configuration"""
    await db.save_model_config(request.provider, request.model, request.whisperModel)
    if request.apiKey != None:
        await db.save_api_key(request.apiKey, request.provider)
    return {"status": "success", "message": "Model configuration saved successfully"}  

@app.get("/get-transcript-config")
async def get_transcript_config():
    """Get the current transcript configuration"""
    transcript_config = await db.get_transcript_config()
    if transcript_config:
        transcript_api_key = await db.get_transcript_api_key(transcript_config["provider"])
        if transcript_api_key != None:
            transcript_config["apiKey"] = transcript_api_key
    return transcript_config

@app.post("/save-transcript-config")
async def save_transcript_config(request: SaveTranscriptConfigRequest):
    """Save the transcript configuration"""
    await db.save_transcript_config(request.provider, request.model)
    if request.apiKey != None:
        await db.save_transcript_api_key(request.apiKey, request.provider)
    return {"status": "success", "message": "Transcript configuration saved successfully"}

class GetApiKeyRequest(BaseModel):
    provider: str

@app.post("/get-api-key")
async def get_api_key(request: GetApiKeyRequest):
    try:
        return await db.get_api_key(request.provider)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/get-transcript-api-key")
async def get_transcript_api_key(request: GetApiKeyRequest):
    try:
        return await db.get_transcript_api_key(request.provider)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class MeetingSummaryUpdate(BaseModel):
    meeting_id: str
    summary: dict

@app.post("/save-meeting-summary")
async def save_meeting_summary(data: MeetingSummaryUpdate):
    """Save a meeting summary"""
    try:
        await db.update_meeting_summary(data.meeting_id, data.summary)
        return {"message": "Meeting summary saved successfully"}
    except ValueError as ve:
        logger.error(f"Value error saving meeting summary: {str(ve)}")
        raise HTTPException(status_code=404, detail=str(ve))
    except Exception as e:
        logger.error(f"Error saving meeting summary: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

class SearchRequest(BaseModel):
    query: str

@app.post("/search-transcripts")
async def search_transcripts(request: SearchRequest):
    """Search through meeting transcripts for the given query"""
    try:
        results = await db.search_transcripts(request.query)
        return JSONResponse(content=results)
    except Exception as e:
        logger.error(f"Error searching transcripts: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# ==================== Speaker Diarization Endpoints ====================

# Lazy import diarization service to avoid errors if dependencies not installed
_diarization_service = None

def get_diarization_service():
    """Get or create the diarization service singleton."""
    global _diarization_service
    if _diarization_service is None:
        try:
            from diarization_service import get_diarization_service as _get_service
            _diarization_service = _get_service()
        except ImportError as e:
            logger.warning(f"Diarization service not available: {e}")
            raise HTTPException(
                status_code=503,
                detail="Speaker diarization not available. Please install pyannote.audio dependencies."
            )
    return _diarization_service


class DiarizationRequest(BaseModel):
    """Request for speaker diarization on an audio file"""
    audio_path: str
    meeting_id: Optional[str] = None
    session_id: Optional[str] = None  # Session ID for cross-chunk speaker tracking
    min_speakers: Optional[int] = None
    max_speakers: Optional[int] = None


class DiarizationConfigRequest(BaseModel):
    """Request to configure diarization settings"""
    hf_token: Optional[str] = None


class SpeakerLabelUpdate(BaseModel):
    """Request to update speaker labels"""
    meeting_id: str
    speaker_mappings: dict  # Maps speaker_id to speaker_label (e.g., {"SPEAKER_00": "John"})


@app.get("/diarization/status")
async def get_diarization_status():
    """Get the status of the diarization service and models"""
    try:
        service = get_diarization_service()
        model_info = await service.check_model_status()
        
        return JSONResponse(content={
            "available": True,
            "model_loaded": service.is_model_loaded,
            "device": service.device,
            "speaker_tracking_available": service.speaker_tracking_available,
            "model": model_info.__dict__ if model_info else None
        })
    except HTTPException:
        return JSONResponse(content={
            "available": False,
            "model_loaded": False,
            "device": "cpu",
            "model": None,
            "error": "Diarization dependencies not installed"
        })
    except Exception as e:
        logger.error(f"Error getting diarization status: {e}")
        return JSONResponse(content={
            "available": False,
            "model_loaded": False,
            "device": "cpu",
            "model": None,
            "error": str(e)
        })


@app.post("/diarization/configure")
async def configure_diarization(config: DiarizationConfigRequest):
    """Configure the diarization service with Hugging Face token"""
    try:
        if config.hf_token:
            # Save token to database for persistence
            await db.save_diarization_config(hf_token=config.hf_token)
            
            # Reinitialize service with new token using factory function
            global _diarization_service
            from diarization_service import get_diarization_service as _get_service
            _diarization_service = _get_service(hf_token=config.hf_token)
            
            logger.info("Diarization service configured with new HF token")
            
        return {"status": "success", "message": "Diarization configured successfully"}
    except Exception as e:
        logger.error(f"Error configuring diarization: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/diarization/load-model")
async def load_diarization_model():
    """Load the diarization model into memory"""
    try:
        service = get_diarization_service()
        success = await service.load_model()
        
        if success:
            return {"status": "success", "message": "Model loaded successfully", "device": service.device}
        else:
            raise HTTPException(status_code=500, detail="Failed to load model")
    except Exception as e:
        logger.error(f"Error loading diarization model: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/diarization/unload-model")
async def unload_diarization_model():
    """Unload the diarization model to free memory"""
    try:
        service = get_diarization_service()
        service.unload_model()
        return {"status": "success", "message": "Model unloaded successfully"}
    except Exception as e:
        logger.error(f"Error unloading diarization model: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/diarization/process")
async def process_diarization(request: DiarizationRequest, background_tasks: BackgroundTasks):
    """
    Process speaker diarization on an audio file.
    
    This identifies distinct speakers in the audio and returns their speaking segments.
    Results can be used to assign speaker labels to transcript segments.
    
    When session_id is provided, uses cross-chunk speaker tracking to maintain
    consistent speaker IDs across multiple audio chunks within the same meeting.
    """
    try:
        service = get_diarization_service()
        
        # Ensure model is loaded
        if not service.is_model_loaded:
            await service.load_model()
        
        # Run diarization (with cross-chunk tracking if session_id provided)
        if request.session_id:
            result = await service.diarize_audio_with_tracking(
                audio_path=request.audio_path,
                session_id=request.session_id,
                min_speakers=request.min_speakers,
                max_speakers=request.max_speakers
            )
        else:
            result = await service.diarize_audio(
                audio_path=request.audio_path,
                min_speakers=request.min_speakers,
                max_speakers=request.max_speakers
            )
        
        # If meeting_id provided, update transcripts with speaker info
        if request.meeting_id:
            # Get meeting transcripts from database
            meeting = await db.get_meeting(request.meeting_id)
            if meeting and meeting.get("transcripts"):
                # Assign speakers to transcripts
                updated_transcripts = service.assign_speakers_to_transcripts(
                    result,
                    meeting["transcripts"]
                )
                
                # Save updated transcripts with speaker IDs
                await db.update_transcript_speakers(request.meeting_id, updated_transcripts)
        
        return JSONResponse(content={
            "status": "success",
            "result": result.to_dict()
        })
        
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Error processing diarization: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/diarization/update-speaker-labels")
async def update_speaker_labels(request: SpeakerLabelUpdate):
    """
    Update speaker labels for a meeting's transcripts.
    
    Maps generic speaker IDs (e.g., "SPEAKER_00") to human-readable names (e.g., "John").
    These labels are persisted and used in summaries.
    """
    try:
        # Update speaker labels in database
        await db.update_speaker_labels(request.meeting_id, request.speaker_mappings)
        
        return {"status": "success", "message": "Speaker labels updated successfully"}
    except Exception as e:
        logger.error(f"Error updating speaker labels: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/diarization/speaker-labels/{meeting_id}")
async def get_speaker_labels(meeting_id: str):
    """Get saved speaker labels for a meeting"""
    try:
        labels = await db.get_speaker_labels(meeting_id)
        return JSONResponse(content={"meeting_id": meeting_id, "speaker_labels": labels or {}})
    except Exception as e:
        logger.error(f"Error getting speaker labels: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/diarization/config")
async def get_diarization_config():
    """Get current diarization configuration"""
    try:
        config = await db.get_diarization_config()
        # Mask the token for security
        if config and config.get("hf_token"):
            token = config["hf_token"]
            config["hf_token_masked"] = f"{token[:4]}...{token[-4:]}" if len(token) > 8 else "****"
            config["hf_token_configured"] = True
        else:
            config = {"hf_token_configured": False}
        
        return JSONResponse(content=config)
    except Exception as e:
        logger.error(f"Error getting diarization config: {e}")
        return JSONResponse(content={"hf_token_configured": False})


@app.get("/diarization/session/{session_id}/speakers")
async def get_session_speakers(session_id: str):
    """
    Get speaker information for a session.
    
    Returns summary of all speakers detected in the session,
    including their total speaking duration and number of chunks.
    Uses cross-chunk speaker tracking data.
    """
    try:
        service = get_diarization_service()
        speakers = service.get_session_speakers(session_id)
        
        return JSONResponse(content={
            "session_id": session_id,
            "speakers": speakers,
            "speaker_count": len(speakers),
            "speaker_tracking_available": service.speaker_tracking_available
        })
    except HTTPException:
        return JSONResponse(content={
            "session_id": session_id,
            "speakers": [],
            "speaker_count": 0,
            "speaker_tracking_available": False
        })
    except Exception as e:
        logger.error(f"Error getting session speakers: {e}")
        return JSONResponse(content={
            "session_id": session_id,
            "speakers": [],
            "speaker_count": 0,
            "error": str(e)
        })


@app.delete("/diarization/session/{session_id}")
async def clear_diarization_session(session_id: str):
    """
    Clear speaker tracking data for a session.
    Call this when a meeting ends to free memory.
    Embeddings are also removed from disk if persistence is enabled.
    """
    try:
        service = get_diarization_service()
        service.clear_session(session_id)
        
        return {"status": "ok", "message": f"Session {session_id} cleared"}
    except HTTPException:
        return {"status": "ok", "message": "Diarization service not available, nothing to clear"}
    except Exception as e:
        logger.error(f"Error clearing session: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on API shutdown"""
    logger.info("API shutting down, cleaning up resources")
    try:
        processor.cleanup()
        # Clean up diarization service if loaded
        global _diarization_service
        if _diarization_service is not None:
            _diarization_service.unload_model()
            _diarization_service = None
        logger.info("Successfully cleaned up resources")
    except Exception as e:
        logger.error(f"Error during cleanup: {str(e)}", exc_info=True)

if __name__ == "__main__":
    import multiprocessing
    multiprocessing.freeze_support()
    uvicorn.run("main:app", host="0.0.0.0", port=5167, reload=True)
