"""Provenance labels and domain vocabularies shared across the platform."""

DOCUMENTED = "DOCUMENTED"            # stated in a source document / published dataset
REPORTED = "REPORTED"                # reported by a passenger; not verified
PROCESSED = "PROCESSED"              # deterministic calculation over documented data
MODEL_PREDICTED = "MODEL_PREDICTED"  # output of a trained model
AI_HYPOTHESIS = "AI_HYPOTHESIS"      # inference by the agentic pipeline; needs review
POTENTIAL = "POTENTIAL"              # possible risk/issue, unconfirmed
SIMULATION = "SIMULATION"
VERIFIED = "VERIFIED"                # confirmed by a human verification step
PENDING = "PENDING"
INSUFFICIENT_EVIDENCE = "INSUFFICIENT_EVIDENCE"
REQUIRES_REVIEW = "REQUIRES_REVIEW"

ALL_LABELS = [DOCUMENTED, REPORTED, PROCESSED, MODEL_PREDICTED, AI_HYPOTHESIS, POTENTIAL, SIMULATION,
              VERIFIED, PENDING, INSUFFICIENT_EVIDENCE, REQUIRES_REVIEW]

INSUFFICIENT_MSG = "Insufficient verified evidence to support this conclusion."

COMPLAINT_CATEGORIES = {
    "cleanliness": {"en": "Cleanliness", "ta": "தூய்மை"},
    "lifts_escalators": {"en": "Lifts & Escalators", "ta": "மின்தூக்கிகள் & நகரும் படிக்கட்டுகள்"},
    "accessibility": {"en": "Accessibility", "ta": "அணுகல் வசதி"},
    "ticketing": {"en": "Ticketing", "ta": "பயணச்சீட்டு"},
    "station_facilities": {"en": "Station Facilities", "ta": "நிலைய வசதிகள்"},
    "safety": {"en": "Safety Concern", "ta": "பாதுகாப்பு கவலை"},
    "parking": {"en": "Parking", "ta": "வாகன நிறுத்தம்"},
    "other": {"en": "Other", "ta": "மற்றவை"},
}

TEAMS = ["Station Operations", "Lifts & Escalators (E&M)", "Housekeeping", "Ticketing & AFC",
         "Safety & Security", "Civil & Structures", "Parking Management", "Customer Relations"]

CATEGORY_TEAM = {
    "cleanliness": "Housekeeping",
    "lifts_escalators": "Lifts & Escalators (E&M)",
    "accessibility": "Station Operations",
    "ticketing": "Ticketing & AFC",
    "station_facilities": "Station Operations",
    "safety": "Safety & Security",
    "parking": "Parking Management",
    "other": "Customer Relations",
}
