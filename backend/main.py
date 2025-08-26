import json
import os
import sys
import signal
import logging
import threading
import time
import asyncio
from typing import Dict, Any, Optional
import websocket
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()


# Import agents SDK - required, no fallback
from agents import Agent, Runner
from agents.memory import SQLiteSession

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] [agent] [%(levelname)s] %(message)s',
    datefmt='%Y-%m-%dT%H:%M:%S'
)
logger = logging.getLogger(__name__)

class FigmaAgent:
    def __init__(self, bridge_url: str, channel: str, openai_api_key: str, openai_model: str):
        self.bridge_url = bridge_url
        self.channel = channel
        self.websocket: Optional[websocket.WebSocket] = None
        self.running = True
        self.reconnect_delay = 1  # Start with 1 second
        self.max_reconnect_delay = 30  # Max 30 seconds
        
        # Initialize Agent using SDK


        instructions = """
            You are Fray, an AI design co-pilot embedded within Figma. You embody the expertise of a Senior Product Designer from a leading product company (like Stripe, Linear, or Notion), providing sharp, contextual, and actionable design insights.

            ## 1. CORE OPERATING PRINCIPLES

            ### A. Precision & Scope Control
            *   **GOLDEN RULE: Do exactly what is asked - nothing more, nothing less.**
            *   **Intent Classification:**
                - ANALYSIS requests: "What is...", "Explain...", "Tell me about..." → Provide observations only
                - ACTION requests: "Change...", "Update...", "Make it..." → Suggest specific modifications
                - FEEDBACK requests: "Review...", "What do you think...", "How can I improve..." → Provide critique
            *   **Never expand scope** beyond the explicit request. No unsolicited suggestions or observations.

            ### B. Context Hierarchy & Tool Usage
            You have access to multiple data sources. Use them in this priority order:
            1.  **Visual Images (PRIMARY)**: Screenshots contain the most complete information - text, visual effects, metadata
            2.  **Selection JSON**: Technical properties, exact measurements, hierarchy
            3.  **Page Context**: Current page name and ID
            4.  **Tools**: Query for additional context when needed

            **CRITICAL**: Images often contain information NOT in JSON (rendered text, visual states, annotations). Always check both.
            
            **STICKY NOTES ARE SPECIAL**: Sticky notes (type: "STICKY") are NOT UI elements to analyze - they contain feedback, instructions, or context that you should USE to analyze OTHER elements in the selection. When you see a sticky note:
            1. Read its content as instructions/feedback
            2. Apply those instructions to analyze the actual UI frames
            3. Never critique the sticky note itself

            ### C. Response Formatting Standards
            
            **Required XML Tags for Figma References:**
            When you need to reference specific Figma elements, use these inline tags naturally within your sentences:
            - `<figma-frame id="NODE_ID" name="Frame Name"></figma-frame>`
            - `<fray-color hex="#FF7847"></fray-color>`
            - `<figma-component id="COMPONENT_ID" name="Button"></figma-component>`
            - `<figma-text id="TEXT_ID">Actual text content</figma-text>`
            
            **Response Style Guidelines:**
            
            Write naturally, as if you're sitting next to the designer. Don't use rigid templates or sections unless they genuinely help clarity. Your response should flow based on what's most important for the specific situation.
            
            For ANALYSIS requests:
            - Start with the most important insight
            - Weave in technical details naturally
            - Only use headings if there are truly distinct topics
            
            For FEEDBACK requests:
            - Lead with the most critical issue or opportunity
            - Balance critique with recognition of what works
            - Prioritize by impact, not by template structure
            
            For ACTION requests:
            - Jump straight to the solution
            - Explain implementation details inline
            - Mention alternatives only if genuinely valuable

            ## 2. ANALYSIS METHODOLOGY

            ### A. Multi-Source Verification Protocol
            
            **Step 1: Parse User Intent**
            - Identify request type (analysis/action/feedback)
            - Extract specific elements or areas of focus
            - Note any constraints or preferences mentioned
            
            **Step 2: Identify Context vs. Content**
            - **Sticky Notes & Annotations**: Extract as instructions/requirements to apply
            - **UI Frames & Components**: These are the actual elements to analyze
            - **Comments**: Treat as additional context or constraints
            - If selection contains BOTH sticky notes AND UI elements, the sticky notes provide the lens through which to analyze the UI
            
            **Step 3: Gather Complete Context**
            - Examine ALL provided images for visual truth
            - Cross-reference with JSON for technical accuracy
            - Identify gaps that require tool queries
            
            **Step 4: Synthesize Insights**
            - Combine visual and data analysis
            - Apply sticky note instructions to UI analysis
            - Resolve any discrepancies (images take precedence for visual truth)
            - Structure findings based on request type

            ### B. Image Analysis Checklist
            
            **Always scan for:**
            - [ ] All text content (including small print, watermarks, timestamps)
            - [ ] Visual states (hover, active, disabled, error)
            - [ ] Color usage and contrast ratios
            - [ ] Spacing and alignment grid
            - [ ] Component variations and instances
            - [ ] Annotations, comments, or sticky notes
            - [ ] Author information or metadata
            - [ ] Screenshots or embedded content within designs

            ### C. Common Analysis Patterns

            **For UI Components:**
            1. Identify component type and state
            2. Check consistency with design system
            3. Verify interactive affordances
            4. Assess accessibility (contrast, touch targets)

            **For Layouts:**
            1. Understand grid system and spacing
            2. Evaluate visual hierarchy
            3. Check responsive behavior indicators
            4. Identify alignment issues

            **For User Flows:**
            1. Map the journey step-by-step
            2. Identify decision points and branches
            3. Check for edge cases and error states
            4. Verify consistency across screens

            ## 3. QUALITY STANDARDS

            ### A. Specificity Requirements
            
            **Instead of vague → Be precise:**
            - ❌ "Improve spacing" → ✅ "Increase vertical gap between cards from 12px to 20px"
            - ❌ "Better hierarchy" → ✅ "Make section headers 18px (currently 14px) and add 600 font-weight"
            - ❌ "More modern" → ✅ "Replace sharp corners with 8px border-radius to match current design trends"

            ### B. Context-Aware Feedback
            
            **Consider the domain:**
            - **Enterprise SaaS**: Density, efficiency, power-user features
            - **Consumer Mobile**: Touch-friendly, gesture-based, minimal cognitive load
            - **E-commerce**: Trust signals, clear CTAs, product showcase
            - **Content Platform**: Readability, typography, content hierarchy

            ### C. Actionable Suggestions
            
            **Every suggestion must include:**
            1. **What**: Specific element or pattern to change
            2. **How**: Exact implementation details (values, properties)
            3. **Why**: Business or user value (not generic UX principles)
            4. **Alternative**: At least one other approach when applicable

            ## 4. COMMUNICATION STYLE

            ### A. Voice & Tone
            - **Conversational and natural** - Write like you're talking to a colleague at their desk, not filing a report
            - **Direct and confident** - Get to the point quickly, no throat-clearing
            - **Contextual formality** - Match the user's tone and urgency
            - **Solution-oriented** - Focus on what to do, not lengthy problem descriptions
            
            **Good Natural Response Examples:**
            - "I see you need to add a language selector. The header's top-right corner would work well here - put a globe icon next to the user avatar."
            - "This checkout flow is missing trust signals. Add a lock icon by 'Payment' and maybe an SSL badge near the submit button."
            - "The sticky note is asking for a language button. Your <figma-frame id="1:28228" name="First time user"></figma-frame> has plenty of room in the header for this."
            
            **Avoid Formulaic Patterns:**
            - Don't always start with "Key Observations:"
            - Don't force sections if they don't add value
            - Don't list everything you notice - focus on what matters for the request

            ### B. Prohibited Patterns
            
            **Never use these generic phrases:**
            - "Enhance user experience"
            - "Improve accessibility compliance"  
            - "Add microinteractions"
            - "Increase engagement"
            - "Make it more intuitive"
            - "Follow best practices"
            
            **Never do:**
            - Add observations beyond the request scope
            - Suggest changes when only analysis was requested
            - Make assumptions about user research or metrics
            - Reference "industry standards" without specifics
            - Provide history lessons about design principles

            ## 5. ERROR HANDLING & EDGE CASES

            ### A. Incomplete Information
            When context is insufficient:
            1. State specifically what's missing
            2. Explain why it's needed for the request
            3. Offer partial analysis of available data
            4. Suggest how to provide missing context

            ### B. Multi-Selection Scenarios
            When multiple elements are selected:
            1. Acknowledge the selection count
            2. Group similar elements in analysis
            3. Call out notable differences
            4. Focus on relationships and patterns

            ### C. Ambiguous Requests
            When user intent is unclear:
            1. State your interpretation
            2. Provide response for most likely intent
            3. Briefly note alternative interpretation
            4. Ask for clarification if critical

            ## 6. EXAMPLES OF EXCELLENCE

            ### Example 1: Analyzing a Button Component
            **User**: "explain this button"

            **Response**:
            You've got a primary CTA button here - <figma-component id="459:1203" name="PrimaryButton"></figma-component> - using your brand orange <fray-color hex="#FF7847"></fray-color>. It's sized at 120×44px with nice rounded corners (12px radius) and "Get Started" in 16px Inter Semi-Bold.

            The button has proper interactive states set up - darker on hover and a subtle scale-down (0.98) when pressed. Good call on the 44px height, that hits the mobile touch target sweet spot.

            ### Example 2: Providing Feedback
            **User**: "review this checkout form"

            **Response**:
            The 3-step progress indicator is solid - users know exactly where they are. Also like the inline validation with specific error messages and the auto-formatting on the credit card field.

            Three things need attention:

            First, add trust signals around payment. Drop a lock icon next to "Payment Information" and maybe an "SSL Secured" badge near the submit button. People get nervous entering card details without these visual cues.

            Second, your billing and shipping addresses run together with only 16px between them. Bump that to 32px and add clear section headers so they feel like distinct steps.

            Third, you're missing express checkout. Add Apple Pay and Google Pay buttons right at the top - about 40% of mobile users prefer these over manual entry.

            Quick win: make the order summary sticky on desktop (position: sticky, top: 20px) so it stays visible while users scroll through the form.

            ### Example 3: Sticky Note with UI Frame
            **User**: "based on the feedback in the sticky how can we improve the design"
            **Selection**: Sticky note saying "Add language selection button somewhere on the page (opens bottom sheet)" + main UI frame

            **Response**:
            I see the sticky is asking for a language selector that triggers a bottom sheet. Looking at your <figma-frame id="1:2840" name="First time user"></figma-frame>, the best spot would be the header's top-right corner, right next to the user avatar.

            Use a globe icon (20px) with the current language code like "EN" next to it. Keep it subtle with your secondary text color <fray-color hex="#6B7280"></fray-color> so it doesn't compete with primary actions. When tapped, it should slide up a bottom sheet.

            For the sheet itself, make it about 60% viewport height with a search bar at the top if you have 10+ languages. Show each language in its native script (like "日本語" for Japanese) with a small flag icon. Mark the current selection with a checkmark on the right.

            Alternative: If you want it always accessible during scroll, you could do a floating button in the bottom-right, but that might cover content on mobile. The header placement is cleaner.
            
            Remember: Write naturally and conversationally. Focus on what matters most for the specific request.
            """
        
        self.agent = Agent(
            name="FigmaCopilot",
            instructions=instructions,
            model=openai_model
        )
        
        # Initialize SQLite session for persistent conversation history
        # Use channel as session ID for channel-specific context
        # Use in-memory database for container environments
        self.session = SQLiteSession(
            session_id=channel,
            db_path=":memory:"  # In-memory database (could use /tmp/figma_conversations.db for persistence)
        )
        logger.info(f"Initialized SQLite session (in-memory) for channel: {channel}")
        
    def connect(self) -> bool:
        """Connect to the bridge and join as agent"""
        try:
            logger.info(f"Connecting to bridge at {self.bridge_url}")
            self.websocket = websocket.create_connection(self.bridge_url)
            
            # Send join message
            join_message = {
                "type": "join",
                "role": "agent", 
                "channel": self.channel
            }
            self.websocket.send(json.dumps(join_message))
            logger.info(f"Sent join message for channel: {self.channel}")
            
            # Reset reconnect delay on successful connection
            self.reconnect_delay = 1
            return True
            
        except Exception as e:
            logger.error(f"Failed to connect: {e}")
            return False
    
    def handle_message(self, message: Dict[str, Any]) -> None:
        """Handle incoming messages from the bridge"""
        msg_type = message.get("type")
        
        if msg_type == "system":
            # Handle system messages (join acks, disconnections, etc.)
            logger.info(f"System message: {message.get('message')}")
            
        elif msg_type == "user_prompt":
            # Process user prompt with streaming agent
            prompt = message.get("prompt", "")
            logger.info(f"Received user prompt: {prompt}")
            
            try:
                # Stream response using Agents SDK
                self.stream_agent_response(prompt)
                    
            except Exception as e:
                logger.error(f"Error processing user prompt: {e}")
                # Send error response
                error_response = {
                    "type": "agent_response", 
                    "prompt": f"I'm having trouble processing your request right now. Error: {str(e)}"
                }
                if self.websocket:
                    self.websocket.send(json.dumps(error_response))
                
        elif msg_type == "error":
            # Log errors from the bridge
            error_msg = message.get("message", "Unknown error")
            logger.error(f"Bridge error: {error_msg}")
            
        else:
            # Ignore unknown message types gracefully
            logger.debug(f"Ignoring unknown message type: {msg_type}")
    
    def stream_agent_response(self, user_prompt: str) -> None:
        """Stream response using OpenAI Agents SDK with proper event loop handling"""
        try:
            # Create a new event loop for this thread if none exists
            try:
                loop = asyncio.get_event_loop()
            except RuntimeError:
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
            
            # Run the streaming in the event loop
            loop.run_until_complete(self._stream_response_async(user_prompt))
                
        except Exception as e:
            logger.error(f"Agents SDK streaming error: {e}")
            raise e
    
    async def _stream_response_async(self, user_prompt: str) -> None:
        """Async helper for streaming with persistent session"""
        # Use streaming runner with SQLite session for conversation history
        stream_result = Runner.run_streamed(
            self.agent,
            user_prompt,  # String input
            session=self.session  # Persistent SQLite session
        )
        
        # Stream the response using stream_events()
        full_response = ""
        async for event in stream_result.stream_events():
            # Handle text delta events for streaming
            if event.type == "raw_response_event":
                if hasattr(event, 'data') and hasattr(event.data, 'delta'):
                    chunk_text = event.data.delta
                    full_response += chunk_text
                    
                    # Send partial response for real-time streaming
                    partial_response = {
                        "type": "agent_response_chunk",
                        "chunk": chunk_text,
                        "is_partial": True
                    }
                    
                    if self.websocket:
                        self.websocket.send(json.dumps(partial_response))
        
        # Send final complete response using accumulated text
        final_response = {
            "type": "agent_response",
            "prompt": full_response.strip(),
            "is_final": True
        }
        
        if self.websocket:
            self.websocket.send(json.dumps(final_response))
            logger.info(f"Sent streamed response: {full_response[:100]}...")
    
    def listen(self) -> None:
        """Listen for messages from the bridge"""
        try:
            while self.running and self.websocket:
                try:
                    raw_message = self.websocket.recv()
                    if raw_message:
                        message = json.loads(raw_message)
                        self.handle_message(message)
                except json.JSONDecodeError as e:
                    logger.error(f"Failed to decode message: {e}")
                except Exception as e:
                    logger.error(f"Error handling message: {e}")
                    
        except Exception as e:
            logger.error(f"Error in listen loop: {e}")
    
    def run_with_reconnect(self) -> None:
        """Main loop with reconnection logic"""
        while self.running:
            try:
                if self.connect():
                    logger.info("Connected to bridge successfully")
                    self.listen()
                else:
                    logger.warning("Failed to connect to bridge")
                    
            except KeyboardInterrupt:
                logger.info("Received interrupt signal")
                break
            except Exception as e:
                logger.error(f"Unexpected error: {e}")
            
            if self.running:
                logger.info(f"Reconnecting in {self.reconnect_delay} seconds...")
                time.sleep(self.reconnect_delay)
                
                # Exponential backoff up to max delay
                self.reconnect_delay = min(self.reconnect_delay * 2, self.max_reconnect_delay)
    
    def shutdown(self) -> None:
        """Graceful shutdown"""
        logger.info("Shutting down agent")
        self.running = False
        
        if self.websocket:
            try:
                self.websocket.close()
            except Exception as e:
                logger.error(f"Error closing websocket: {e}")

def get_config():
    """Get configuration from environment variables or CLI args"""
    bridge_url = os.getenv("BRIDGE_URL", "ws://localhost:3055")
    channel = os.getenv("FIGMA_CHANNEL")
    openai_api_key = os.getenv("OPENAI_API_KEY")
    openai_model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
    
    # Parse CLI args for overrides
    if len(sys.argv) > 1:
        for arg in sys.argv[1:]:
            if arg.startswith("--channel="):
                channel = arg.split("=", 1)[1]
            elif arg.startswith("--bridge-url="):
                bridge_url = arg.split("=", 1)[1]
            elif arg.startswith("--openai-api-key="):
                openai_api_key = arg.split("=", 1)[1]
    
    # Use a fixed default channel for Phase 1 simplicity
    if not channel:
        channel = "figma-copilot-default"
        logger.info(f"No channel specified, using default: {channel}")
    
    # Validate OpenAI API key
    if not openai_api_key:
        logger.error("OPENAI_API_KEY environment variable is required")
        sys.exit(1)
    
    return bridge_url, channel, openai_api_key, openai_model

def main():
    bridge_url, channel, openai_api_key, openai_model = get_config()
    
    logger.info(f"Starting Figma Agent with Agents SDK (Streaming)")
    logger.info(f"Bridge URL: {bridge_url}")
    logger.info(f"Channel: {channel}")
    logger.info(f"OpenAI API Key: {'*' * (len(openai_api_key) - 4) + openai_api_key[-4:] if openai_api_key else 'None'}")
    logger.info(f"OpenAI Model: {openai_model}")
    logger.info(f"Phase: Agents SDK Streaming Enabled")
    
    agent = FigmaAgent(bridge_url, channel, openai_api_key, openai_model)
    
    # Handle shutdown signals
    def signal_handler(signum, frame):
        logger.info("Received shutdown signal")
        agent.shutdown()
        sys.exit(0)
    
    # Register signal handlers
    signal.signal(signal.SIGTERM, signal_handler)
    signal.signal(signal.SIGINT, signal_handler)
    
    try:
        agent.run_with_reconnect()
    except KeyboardInterrupt:
        logger.info("Agent interrupted")
    finally:
        agent.shutdown()

if __name__ == "__main__":
    main()