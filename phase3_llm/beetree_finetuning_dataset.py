#!/usr/bin/env python3
"""
BeeTree Gemma 4 Fine-Tuning Dataset Generator
Generates Q&A pairs for a beekeeping advisor LLM from:
1. UrBAN inspection notes (2021-2022) - real beekeeper observations
2. Georgia Master Beekeeper Program curriculum - structured knowledge
3. Beekeeping domain thresholds and decision tables - synthetic Q&A

Output: JSONL format for Gemma 4 fine-tuning (instruction + response pairs)
"""

import json
import csv
import os
from datetime import datetime

DATA_DIR = os.path.expanduser("~/UrBAN/data/annotations")
OUTPUT_DIR = os.path.expanduser("~/UrBAN/finetuning")
os.makedirs(OUTPUT_DIR, exist_ok=True)

# ============================================================
# Part 1: Convert UrBAN inspection data to Q&A pairs
# ============================================================

def load_inspections_2021():
    """Load 2021 inspection CSV and convert to Q&A pairs"""
    pairs = []
    with open(os.path.join(DATA_DIR, "inspections_2021.csv")) as f:
        reader = csv.DictReader(f)
        inspections = list(reader)
    
    # Group by date for context
    by_date = {}
    for row in inspections:
        d = row.get("Date", "")
        if d not in by_date:
            by_date[d] = []
        by_date[d].append(row)
    
    for date, hives in by_date.items():
        # Summary Q&A for each inspection day
        hive_summaries = []
        for h in hives:
            tag = h.get("Tag number", "")
            colony_size = h.get("Colony Size", "")
            fob_values = [h.get(f) for f in ["Fob 1st", "Fob 2nd", "Fob 3rd"] if h.get(f)]
            fob_str = " + ".join(fob_values) if fob_values else "0"
            foBrood = h.get("FoBrood", "")
            queen = h.get("Queen status", "")
            honey = h.get("Frames of Honey", "")
            notes = h.get("Notes", "")
            
            summary = f"Hive {tag}: {colony_size} box(es), {fob_str} frames of bees"
            if foBrood:
                summary += f", {foBrood} frames of brood"
            if queen:
                summary += f", queen {queen}"
            if honey:
                summary += f", {honey} frames of honey"
            if notes:
                summary += f". Notes: {notes}"
            hive_summaries.append(summary)
        
        # Generate Q&A
        pairs.append({
            "instruction": f"I inspected my apiary on {date}. Here's what I found across {len(hives)} hives. Can you summarize the overall health and flag any concerns?",
            "input": "\n".join(hive_summaries),
            "response": generate_inspection_analysis(hives, date)
        })
        
        # Individual hive Q&A
        for h in hives:
            tag = h.get("Tag number", "")
            notes = h.get("Notes", "")
            if not notes:
                continue
            pairs.append({
                "instruction": f"During my hive inspection, I noticed: \"{notes}\". What does this mean and what should I do?",
                "input": "",
                "response": generate_notes_response(notes, h)
            })
    
    return pairs

def generate_inspection_analysis(hives, date):
    """Generate analysis from inspection data"""
    concerns = []
    healthy = 0
    weak = 0
    
    for h in hives:
        notes = h.get("Notes", "").lower()
        queen = h.get("Queen status", "")
        
        if "chalkbrood" in notes:
            concerns.append(f"  - Hive {h.get('Tag number','')}: Chalkbrood detected. Monitor ventilation and consider requeening if persistent.")
        if "aggressive" in notes:
            concerns.append(f"  - Hive {h.get('Tag number','')}: Aggressive behavior noted. Consider requeening with gentler genetics.")
        if "swarm" in notes or "swarm cell" in notes:
            concerns.append(f"  - Hive {h.get('Tag number','')}: Swarm cells present. Consider splitting to prevent swarming.")
        if "supercedure" in notes:
            concerns.append(f"  - Hive {h.get('Tag number','')}: Supercedure cells found. Colony is replacing its queen naturally.")
        if queen == "QNS":
            concerns.append(f"  - Hive {h.get('Tag number','')}: Queen not seen (QNS). Check again in 7-10 days or consider ordering a new queen.")
        if "weak" in notes:
            concerns.append(f"  - Hive {h.get('Tag number','')}: Colony appears weak. Consider combining with a stronger hive.")
        if "running out of space" in notes:
            concerns.append(f"  - Hive {h.get('Tag number','')}: Running out of space. Add another super immediately.")
        
        if not concerns or (queen == "QR" and "weak" not in notes):
            healthy += 1
    
    response = f"Apiary inspection summary for {date}:\n"
    response += f"Total hives inspected: {len(hives)}\n"
    response += f"Healthy hives: {healthy}\n"
    
    if concerns:
        response += f"\nConcerns identified ({len(concerns)}):\n"
        response += "\n".join(concerns)
    else:
        response += "\nNo major concerns identified. All colonies appear healthy and queenright."
    
    # Size distribution
    sizes = [h.get("Colony Size", "") for h in hives]
    response += f"\n\nColony size distribution: {', '.join(f'{s} box(es)' for s in sizes)}"
    
    return response

def generate_notes_response(notes, hive_data):
    """Generate response to a specific inspection note"""
    notes_lower = notes.lower()
    
    responses = {
        "chalkbrood": "Chalkbrood is a fungal infection caused by Ascosphaera apis. It typically appears when colonies are stressed by poor ventilation, high humidity, or cold weather. The affected larvae become mummified and appear chalk-white or grey. \n\nWhat to do:\n1. Improve hive ventilation by propping the outer cover slightly\n2. Remove heavily affected frames\n3. Ensure the hive has good drainage and isn't in a low spot\n4. Consider requeening if the problem persists for more than 2-3 weeks — some queen lines have better hygienic behavior for chalkbrood resistance\n5. The colony may recover on its own if conditions improve",
        
        "swarm cell": "Swarm cells (queen cups with eggs or larvae) indicate the colony is preparing to swarm. This is natural reproduction behavior but means you're about to lose half your bees.\n\nWhat to do:\n1. If cells have eggs but no larvae, you can still prevent swarming by adding space (supers) and splitting the hive\n2. Make a split by removing 2-3 frames with queen cells, bees, and brood to a new hive body\n3. Clip the old queen's wings to prevent the primary swarm from departing\n4. Destroy any queen cells if you want to keep the current queen and don't want to split\n5. Ensure the hive has plenty of room — add supers if needed",
        
        "supercedure cell": "Supercedure cells mean the colony has decided to replace its current queen. This is different from swarm cells (which are on the bottom of frames) — supercedure cells are typically on the face of the comb. The bees may have sensed that the queen is failing (low pheromone production, poor laying pattern, etc.).\n\nWhat to do:\n1. Let it happen — the bees usually know best\n2. The old queen will continue laying until the new queen emerges, mates, and starts laying\n3. Don't destroy supercedure cells unless you want to introduce a queen of your own choosing\n4. Check back in 3-4 weeks to confirm the new queen is mated and laying",
        
        "aggressive": "Aggressive hive behavior can be caused by several factors:\n1. Genetics — some races (especially Africanized hybrids) are naturally more defensive\n2. Queen age — older queens can lead to more defensive behavior\n3. Hive stress — lack of resources, predator attacks, or weather\n4. Time of day — bees are more defensive in late afternoon/evening\n\nWhat to do:\n1. Requeen with gentler stock (Carniolan, Italian, or Buckfast lines)\n2. Work the hive during midday when foragers are out collecting\n3. Use smoke generously but not excessively\n4. Wear full protective gear until the colony calms down\n5. If the aggression persists after requeening, the colony may have Africanized genetics",
        
        "running out of space": "When bees are 'running out of space,' the colony is expanding faster than you've given them room. This is a good problem to have, but it can lead to swarming if not addressed.\n\nWhat to do:\n1. Add a super or hive body immediately — today, not next week\n2. If all supers are drawn out, consider adding drawn comb frames\n3. Add a queen excluder between brood and honey supers if not already present\n4. If you don't add space, the colony will likely swarm within 1-2 weeks",
        
        "queen cell": "Queen cells found during inspection. The type and location matter:\n- Swarm cells: on the bottom edges of frames = colony preparing to swarm\n- Supercedure cells: on the face of frames = colony replacing its queen\n- Emergency cells: built from worker cells = queen died unexpectedly\n\nWhat to do depends on your goal:\n1. If you want to prevent swarming: remove swarm cells and add space\n2. If you want to split: use the queen cells to start a new colony\n3. If you want a new queen: let supercedure cells develop\n4. Count the cells — more than 5-6 suggests swarming intent",
    }
    
    for keyword, response in responses.items():
        if keyword in notes_lower:
            return response
    
    # Generic response
    return f"Your observation \"{notes}\" is noted. This is a routine inspection finding. Continue monitoring the hive and check again in 7-14 days. If the condition persists or worsens, consult your local extension office or master beekeeper for guidance."

def load_inspections_2022():
    """Load 2022 inspection CSV and convert to Q&A pairs"""
    pairs = []
    with open(os.path.join(DATA_DIR, "inspections_2022.csv")) as f:
        reader = csv.DictReader(f)
        inspections = list(reader)
    
    # Group by hive
    by_hive = {}
    for row in inspections:
        tag = row.get("Tag number", "")
        if tag not in by_hive:
            by_hive[tag] = []
        by_hive[tag].append(row)
    
    for tag, records in by_hive.items():
        # Generate timeline Q&A for each hive
        timeline = []
        for r in records:
            date = r.get("Date", "")[:10]
            category = r.get("Category", "")
            action = r.get("Action detail", "")
            queen = r.get("Queen status", "")
            notes = r.get("Report notes", "")
            
            entry = f"{date}: {category}"
            if action:
                entry += f" - {action}"
            if queen:
                entry += f" (queen: {queen})"
            if notes:
                entry += f". {notes}"
            timeline.append(entry)
        
        if not timeline:
            continue
        
        pairs.append({
            "instruction": f"Here is the inspection history for hive {tag} throughout the 2022 season. Can you analyze the colony's health trajectory and provide recommendations?",
            "input": "\n".join(timeline),
            "response": generate_trajectory_analysis(tag, records)
        })
        
        # Varroa-specific Q&A
        for r in records:
            if r.get("Category", "").lower() == "varroa":
                pairs.append({
                    "instruction": f"My varroa mite count for hive {tag} came back positive. What should I do?",
                    "input": "",
                    "response": "Varroa mite management is critical for colony survival. Here's what to do:\n\n1. Determine the infestation level:\n   - If you used a sugar roll or alcohol wash, count mites per 100 bees\n   - Treatment threshold: 3+ mites per 100 bees (summer), 1+ mite per 100 bees (fall)\n\n2. Treatment options by season:\n   - Spring/Summer: Formic acid (Formic Pro), Thymol (Apiguard)\n   - Fall: Oxalic acid vaporization or dribble (when broodless)\n   - Anytime: ApiVar (amitraz) strips\n\n3. Monitor monthly during active season\n4. Recheck 2-3 weeks after treatment to confirm efficacy\n5. Consider resistant stock (VSH or Russian bees) for long-term management"
                })
                break
        
        # Grading Q&A
        gradings = [r for r in records if r.get("Category", "") == "hive grading"]
        if gradings:
            grades = [r.get("Action detail", "") for r in gradings if r.get("Action detail")]
            if grades:
                pairs.append({
                    "instruction": f"My hive {tag} has been graded as '{grades[-1]}' based on recent inspection. What does this mean?",
                    "input": "",
                    "response": generate_grading_response(grades[-1])
                })
    
    return pairs

def generate_trajectory_analysis(tag, records):
    """Analyze colony health over time"""
    response = f"Hive {tag} 2022 season analysis:\n\n"
    
    gradings = [(r.get("Date","")[:10], r.get("Action detail","")) for r in records if r.get("Category") == "hive grading" and r.get("Action detail")]
    fob_readings = [(r.get("Date","")[:10], r.get("Action detail","")) for r in records if r.get("Category") == "frames of bees" and r.get("Action detail")]
    varroa = [(r.get("Date","")[:10], "varroa detected") for r in records if r.get("Category") == "varroa"]
    mortality = [r for r in records if r.get("Is alive") == "0"]
    
    if gradings:
        response += "Colony strength trend:\n"
        for date, grade in gradings:
            response += f"  {date}: {grade}\n"
        
        if gradings[-1][1] == "weak" and gradings[0][1] != "weak":
            response += "\n⚠️ Colony is declining. Possible causes: varroa, queen failure, disease, or resource scarcity.\n"
        elif gradings[-1][1] == "strong" or gradings[-1][1] == "medium":
            response += "\n✓ Colony appears stable.\n"
    
    if fob_readings:
        response += f"\nFrames of bees readings: {', '.join(f'{d}:{v}' for d,v in fob_readings)}\n"
    
    if varroa:
        response += f"\n⚠️ Varroa detected on {varroa[0][0]}. Treatment recommended.\n"
    
    if mortality:
        response += f"\n🔴 Colony mortality recorded. This hive did not survive.\n"
        response += "Likely cause: varroa mite infestation leading to winter mortality. Ensure fall treatment protocols are followed.\n"
    else:
        response += "\nRecommendations:\n"
        response += "1. Continue monthly monitoring\n"
        response += "2. Check varroa levels monthly during summer\n"
        response += "3. Ensure adequate honey stores before winter (60-80 lbs for Georgia climate)\n"
        response += "4. Consider fall oxalic acid treatment when broodless\n"
    
    return response

def generate_grading_response(grade):
    grades = {
        "weak": "A 'weak' grading means the colony has fewer than 5 frames of bees. This is concerning and requires intervention.\n\nWhat to do:\n1. Check for queen issues — is she present and laying?\n2. Check for disease — chalkbrood, nosema, or varroa\n3. Consider combining with a stronger hive if no queen issues found\n4. If queenless, introduce a new queen or queen cell\n5. Feed 1:1 syrup to stimulate brood production\n6. Reduce entrance size to prevent robbing",
        
        "medium": "A 'medium' grading means the colony has 5-15 frames of bees. This is a healthy, average colony.\n\nRecommendations:\n1. Continue regular inspections (every 2-3 weeks)\n2. Monitor for swarm cells in spring\n3. Add supers as needed for honey flow\n4. Check varroa levels monthly\n5. Ensure queen is present and laying well",
        
        "strong": "A 'strong' grading means the colony has 15+ frames of bees across multiple boxes. This is excellent!\n\nRecommendations:\n1. Add supers to prevent swarming\n2. Check for swarm cells weekly during spring\n3. Consider splitting to increase your apiary\n4. Monitor honey production — a strong colony can produce 50-100+ lbs per season\n5. Keep an eye on varroa — strong colonies can tolerate more mites but should still be treated preventively",
        
        "pulled honey super": "This means honey supers were removed during inspection. This is normal during the main honey flow (June-August in Georgia).\n\nAfter pulling supers:\n1. Extract honey within 1-2 days for best quality\n2. Return wet supers to bees for cleaning (place above inner cover)\n3. Assess whether colony needs feeding for winter buildup\n4. Check varroa — post-honey-flow is a good time to treat",
        
        "size - 1d": "This appears to be a size downgrade, meaning the colony has lost a box of bees. This can happen due to swarming, queen failure, or disease.\n\nWhat to do:\n1. Check queen status — is she present and laying?\n2. Check for swarm cells (may have already swarmed)\n3. Check for disease signs\n4. If queenless, introduce a new queen\n5. Feed 1:1 syrup to stimulate population growth\n6. Reduce to single brood box if population is low",
    }
    return grades.get(grade.lower(), f"Grading '{grade}' is noted. Continue monitoring the colony and adjust management accordingly.")

# ============================================================
# Part 2: Beekeeping knowledge base (curriculum-derived)
# ============================================================

def generate_knowledge_base():
    """Generate Q&A pairs from beekeeping curriculum knowledge"""
    pairs = []
    
    # Georgia Master Beekeeper Program levels
    curriculum = [
        {
            "instruction": "What are the certification levels in the Georgia Master Beekeeper Program?",
            "response": """The Georgia Master Beekeeper Program has four certification levels:

1. **Certified Beekeeper** — Entry level. Must pass a written exam and practical hive inspection. Covers basic bee biology, equipment, seasonal management, and common pests/diseases.

2. **Journeyman Beekeeper** — Intermediate. Requires 2+ years of experience, 5 documented hives, and passing advanced exams. Covers queen rearing, nuc production, and advanced pest management.

3. **Master Beekeeper** — Advanced. Requires 5+ years of experience, 15+ hives, demonstrated teaching/mentoring, and passing master-level exams. Covers queen genetics, breeding programs, and pollination contracts.

4. **Master Craftsman Beekeeper** — Expert. The highest level. Requires original research contribution, published article, and mastery of specialized topics like instrumental insemination or commercial operations."""
        },
        {
            "instruction": "What is the seasonal beekeeping calendar for Georgia?",
            "response": """Georgia Beekeeping Seasonal Calendar:

**January-February (Winter):**
- Check food stores (heft the hive — should feel heavy)
- Emergency feeding if light (candy board or fondant)
- Check for dead-outs and clean equipment
- Order packages/nucs for spring
- Don't open hives unless temperature is above 55°F

**March (Late Winter/Early Spring):**
- First inspection on warm day (60°F+)
- Check queen status — look for eggs/brood
- Add pollen patties to stimulate brood production
- Check for swarm preparation (early swarms possible)
- Reverse brood boxes if cluster has moved to top box

**April-May (Spring Buildup):**
- Inspect every 7-10 days
- Add supers before honey flow
- Swarm prevention: add space, split strong colonies
- Catch swarms with bait hives
- Nuc production time

**June-July (Main Flow):**
- Add supers on top as needed
- Extract honey when frames are 75%+ capped
- Monitor for varroa (check monthly)
- Watch for chalkbrood in humid weather
- Keep water source available

**August ( dearth):**
- Remove and extract final honey supers
- Check mite levels — treat if above threshold
- Feed 2:1 syrup for winter stores
- Combine weak hives
- Reduce entrances to prevent robbing

**September-October (Fall):**
- Final varroa treatment (oxalic acid when broodless)
- Ensure 60-80 lbs honey stores for winter
- Install mouse guards
- Ventilation: tilt top slightly, add upper entrance
- Don't disturb hives unnecessarily

**November-December (Winter):**
- Leave hives alone
- Check entrances for blockage (dead bees)
- Monitor for wind/animal damage
- Read bee books and plan next year"""
        },
        {
            "instruction": "How do I treat for Varroa mites?",
            "response": """Varroa mite treatment protocol:

**Monitoring:**
- Sugar roll or alcohol wash: 300 bees (about 1/2 cup)
- Threshold: 3+ mites per 100 bees (summer), 1+ per 100 (fall)
- Check monthly during active season
- Check after treatment to confirm efficacy

**Treatment options by season:**

*Spring/Summer (brood present):*
- Formic acid (Formic Pro/Mite Away II): 7-14 days, can use during honey flow, kills mites under cappings
- Thymol (Apiguard): 2 x 14-day treatments, temperature dependent (70-95°F)
- Hopguard II: contact miticide, needs 3 applications

*Fall (minimal brood):*
- Oxalic acid vaporization: 3-5 treatments, 5-7 days apart, most effective when broodless
- Oxalic acid dribble: single treatment, 5ml per seam of bees

*Anytime:*
- Apivar (amitraz): 42-day treatment, strips in brood chamber, cannot use during honey flow

**Important:**
- Rotate treatments to prevent resistance
- Always follow label instructions
- Check temperature requirements
- Remove strips before honey flow if required
- Combine with IPM: screen bottom boards, resistant stock"""
        },
        {
            "instruction": "How do I know if my hive is queenless and what should I do?",
            "response": """Signs of a queenless hive:

1. **No eggs visible** — eggs are hard to see but indicate queen present within last 3 days
2. **No young larvae** — means queen has been gone 5-9 days
3. **Queen cells** — emergency cells built on worker cell bases
4. **Laying workers** — multiple eggs per cell, drone brood in worker cells (means queenless 3+ weeks)
5. **Declining population** — fewer bees each inspection
6. **Aggressive behavior** — queenless hives can be more defensive
7. **No brood at all** — queenless 21+ days

**What to do:**

If queenless < 2 weeks:
- Check for queen cells — let them raise a new queen (takes 16-21 days from egg)
- Or introduce a mated queen (fastest solution)

If queenless 2-4 weeks:
- Introduce a mated queen via queen cage
- Check for laying workers first (see below)

If laying workers present (3+ weeks queenless):
- This is difficult — laying workers kill introduced queens
- Best solution: combine with a strong queenright hive
- Shake out queenless hive 100 yards away, combine returning bees with queenright hive
- Or do a newspaper combine

**Queen introduction:**
1. Remove any queen cells
2. Place queen cage between two brood frames
3. Keep cork in candy end, remove cork from non-candy end
4. Check in 3 days — if workers are not balling the cage, release
5. Check in 7-10 days for eggs"""
        },
        {
            "instruction": "What equipment do I need to start beekeeping?",
            "response": """Essential beekeeping equipment for beginners:

**Hive components:**
- Bottom board (screened recommended for varroa management)
- 2-3 deep brood boxes (9⅝" each)
- 2-3 medium supers (6⅝" each) for honey
- Frames (10 per box, or 8 with spacer bars)
- Foundation (wax or plastic, wax-coated)
- Inner cover
- Outer (telescoping) cover
- Queen excluder (optional but recommended)

**Protective gear:**
- Bee suit or jacket with veil (full suit for beginners)
- Leather gloves (or nitrile once experienced)
- Closed-toe boots

**Tools:**
- Hive tool (standard 10" preferred)
- Smoker + fuel (pine needles, burlap, cotton)
- Bee brush or feather
- Frame grip (optional)

**Feeding:**
- Boardman/entrance feeder (small hives)
- Top feeder or frame feeder (larger hives)
- Sugar syrup (1:1 spring, 2:1 fall)
- Pollen patties (spring stimulation)

**Harvest:**
- Uncapping knife or fork
- Extractor (rent or share with club)
- Bottling tank/settling tank
- Jars

**Cost estimate for first hive (Georgia):**
- Hive kit: $200-350
- Package bees (3 lbs + queen): $130-175
- Protective gear: $75-150
- Tools: $50
- **Total: ~$500-700 for first hive**

Each additional hive: ~$300-400"""
        },
        {
            "instruction": "How do I prevent swarming?",
            "response": """Swarm prevention strategies:

**Why bees swarm:**
- Overcrowding (most common cause)
- Lack of space
- Old queen with reduced pheromone
- Congestion in brood nest
- Strong nectar flow + limited space

**Prevention techniques (in order of effectiveness):**

1. **Add space early** — Put supers on 2 weeks before you think you need them
2. **Reverse brood boxes** in early spring — moves cluster down, gives space above
3. **Make splits** — Best swarm prevention. Remove 2-3 frames of brood + bees to a new box
4. **Checkerboard** — Alternate empty frames with brood frames to break congestion
5. **Clip queen wings** — prevents primary swarm from leaving (but they'll still try)
6. **Demaree method** — Move queen to bottom box with excluder above, puts brood in top box
7. **Remove queen cells** — Check every 7-10 days during swarm season (April-May in Georgia)

**Swarm season timing (Georgia):**
- Peak: April 15 - May 30
- Secondary swarm: late May - June (cast swarms with virgins)

**If you see swarm cells with larvae:**
- Make a split immediately
- Or remove all cells and add space
- Check again in 7 days

**Remember:** Once cells are capped, you have ~8 days before emergence. If the queen is clipped, the primary swarm can't leave but you may get after-swarms (casts)."""
        },
        {
            "instruction": "What should I look for during a hive inspection?",
            "response": """Hive inspection checklist (do every 10-14 days during active season):

**1. Approach calmly:**
- Smoke entrance lightly, wait 30 seconds
- Smoke under cover when opening
- Work slowly, don't crush bees

**2. Queen status:**
- Look for eggs (tiny, standing on end in cell bottom)
- Look for young larvae (pearly white, curled)
- You don't need to see the queen if eggs are present
- If no eggs: check if queen cells present, may need to requeen

**3. Brood pattern:**
- Good: solid, compact, same-age larvae
- Spotty/patchy: could indicate poor queen, disease, or mite pressure
- Drone brood in worker cells: laying workers or drone-laying queen

**4. Queen cells:**
- Swarm cells: bottom of frames, multiple = preparing to swarm
- Supercedure cells: face of frame, 1-3 = replacing queen
- Emergency cells: face of frame from worker cells = queen died

**5. Honey stores:**
- Check frames of honey (capped honey = ready)
- Need 60-80 lbs for winter in Georgia
- Nectar (uncapped) should be 2/3+ capped before extracting

**6. Diseases/pests:**
- Chalkbrood: mummified larvae, chalk-white or grey
- American Foulbrood: ropiness test, sunken cappings
- Sacbrood: sac-like larvae
- Varroa: check mite drop board, sugar roll test
- Small hive beetle: check under inner cover and corners
- Wax moths: webbing in frames

**7. Space:**
- Are bees running out of room? Add super
- Is there too much empty space? Remove a box

**8. Population:**
- Strong: 15+ frames of bees
- Medium: 5-15 frames
- Weak: < 5 frames — consider combining

**9. Record everything:**
- Date, hive ID, colony size, queen status, notes
- This becomes your management history

**Inspection timing:**
- Best: 10am-2pm (foragers out, calmer bees)
- Worst: evening or cloudy/rainy days"""
        },
        {
            "instruction": "How much honey should I leave for winter in Georgia?",
            "response": """Winter honey stores for Georgia:

**Recommended stores:**
- North Georgia: 60-80 lbs (2-3 medium supers worth)
- Central Georgia: 50-60 lbs
- South Georgia: 40-50 lbs

**How to estimate:**
- A full medium frame (both sides) = ~3.5 lbs honey
- A full deep frame = ~6 lbs honey
- Heft the hive: should feel like you're lifting 50+ lbs
- If the back of the hive is light when you lift, they need feed

**Feeding if stores are low:**
- 2:1 sugar syrup (2 lbs sugar : 1 pint water) in September-October
- Fondant or candy boards for emergency winter feeding (Jan-Feb)
- Never feed liquid syrup when bees can't fly (below 50°F)

**Georgia winter considerations:**
- Georgia winters are short but can have cold snaps
- Bees fly on warm days (50°F+) and consume more stores
- Wind protection is more important than insulation
- Top ventilation prevents condensation (moisture kills more than cold)
- Don't wrap hives in Georgia — can cause overheating on sunny days

**Spring assessment:**
- Check food stores in late February/early March
- Many colonies starve in March when brood rearing ramps up but nectar isn't flowing yet
- Have emergency feed ready (candy boards or fondant)"""
        },
        {
            "instruction": "My hive has chalkbrood. What is it and how do I treat it?",
            "response": """Chalkbrood (Ascosphaera apis) is a fungal disease of honey bee larvae:

**Symptoms:**
- Mummified larvae that look chalk-white, grey, or black
- Hard, shrunken "mummies" on the bottom board or in cells
- Workers may remove mummies and drop them at the entrance
- More common in spring during damp, cool weather
- Not usually fatal to the colony but weakens it

**Causes:**
- High humidity in the hive
- Cool temperatures combined with moisture
- Poor ventilation
- Stress (nutritional, mite pressure)
- Some bee races are more susceptible

**Treatment/Management:**
1. **Improve ventilation** — prop the outer cover slightly, add a vented inner cover
2. **Requeen** — some queen lines have better hygienic behavior (can detect and remove infected larvae)
3. **Reduce moisture** — ensure hive is level or tilted slightly forward for drainage, avoid damp locations
4. **Remove affected comb** — replace with clean drawn comb
5. **Provide good nutrition** — ensure pollen diversity and feed syrup if needed
6. **Reduce stress** — treat for varroa if present, ensure adequate stores
7. **Don't use chemicals** — chalkbrood is fungal, antibiotics don't help
8. **Usually self-resolves** when weather improves and hive ventilation increases

**Prevention:**
- Use screened bottom boards
- Position hives with morning sun exposure
- Avoid low-lying or damp apiary sites
- Maintain strong colonies with good nutrition"""
        },
        {
            "instruction": "What's the difference between a package and a nuc, and which should I buy?",
            "response": """Packages vs. Nucs:

**Package bees:**
- 3 lbs of bees (~10,000) + a mated queen in a cage
- Shipped in a screened box
- Bees are not related to the queen (they accept her over a few days)
- You install them into your own equipment
- Slower start: they must build all comb from scratch
- Cost: $130-175 (Georgia prices)
- Available: March-May
- Best for: experienced beekeepers or those who want specific equipment

**Nuc (nucleus colony):**
- 5 frames with established colony: queen, brood, bees, honey, drawn comb
- Queen is already accepted and laying
- Frames go directly into your hive body
- Faster start: drawn comb means immediate honey production potential
- Cost: $150-200
- Available: April-June (local pickup, cannot ship)
- Best for: beginners, faster buildup, spring splits

**Recommendation for beginners in Georgia:**
- Buy a nuc if available locally — it gives you a huge head start
- The drawn comb alone saves 2-3 weeks of colony development
- The accepted, laying queen means no introduction risk
- You can see brood pattern before committing

**Where to buy (Georgia):**
- Local bee clubs often have members selling nucs
- Georgia Beekeepers Association has a supplier list
- Avoid shipping packages in extreme heat (above 90°F)
- Install packages in the evening for best acceptance"""
        },
    ]
    
    return curriculum

# ============================================================
# Part 3: Audio-acoustic threshold tables for bee health
# ============================================================

def generate_acoustic_knowledge():
    """Generate Q&A about bee acoustics and colony health"""
    pairs = [
        {
            "instruction": "What can bee audio tell us about colony health?",
            "response": """Bee hive acoustics — what the buzz tells us:

**Key acoustic indicators:**

1. **Overall amplitude/volume:**
   - Strong colony = louder hum (more bees = more wing beats)
   - Sudden drop = queen loss, swarming, or disease
   - Increase = population growth or preparation to swarm

2. **Frequency content:**
   - Queenright colony: dominant frequencies around 200-400 Hz (worker activity)
   - Queenless colony: shift in frequency spectrum, loss of organized buzzing
   - Swarming preparation: characteristic "swarm buzz" — high amplitude, specific frequency signature

3. **Tooting and quacking:**
   - Virgin queens "toot" (pulsed high-frequency sound ~400-500 Hz)
   - Worker bees "quack" in response
   - Indicates queen emergence/swarming imminent

4. **Daily patterns:**
   - Morning: low frequency (waking up)
   - Midday: peak frequency (foraging activity)
   - Evening: frequency drops (settling in)
   - Night: very low (clustering for warmth)

5. **Seasonal patterns:**
   - Spring: increasing amplitude (population growth)
   - Summer: highest amplitude (peak population)
   - Fall: decreasing amplitude (population decline)
   - Winter: very low amplitude (cluster maintenance)

6. **Anomalous sounds:**
   - High-pitched whine: queenless or queen introduction distress
   - Absence of hum: colony death or absconding
   - Irregular buzzing: disease stress or pesticide exposure

**BeeTree application:**
- Continuous monitoring detects changes before visual inspection reveals problems
- Audio can be sampled 24/7 without opening the hive (non-invasive)
- Modulation tensorgrams capture time-varying spectral patterns
- Machine learning models classify colony strength from audio alone
- PDM microphones capture clean in-hive audio for analysis"""
        },
        {
            "instruction": "How does the BeeTree system use audio to assess colony strength?",
            "response": """BeeTree acoustic colony assessment:

**Pipeline:**
1. an in-hive PDM microphone records 60-second audio windows at 16kHz
2. Audio is compressed into modulation tensorgrams (~44KB per window)
3. CNN/CRDNN model predicts frames of bees (colony strength metric)
4. Results displayed on BeeTree dashboard with trend over time
5. Alerts triggered for sudden drops (swarming, queen loss, disease)

**Colony strength classification:**
- Weak: < 5 frames of bees (needs intervention)
- Medium: 5-15 frames (healthy, average)
- Strong: 15+ frames (excellent, watch for swarming)

**Advantages over visual inspection:**
- Non-invasive (don't open hive, don't disturb bees)
- 24/7 monitoring (inspections only happen every 10-14 days)
- Early detection (audio changes precede visible symptoms)
- Historical trend (see gradual changes over weeks/months)
- Remote monitoring (beekeeper doesn't need to visit apiary)

**Limitations:**
- Audio doesn't detect all issues (e.g., specific diseases)
- Cross-hive generalization requires training on multiple apiaries
- Weather affects audio (wind, rain noise)
- Model accuracy depends on training data quality

**The science:**
Research from INRS (Falk group) and Nectar Technologies validated that modulation tensorgrams + deep learning achieve competitive colony strength prediction from in-hive audio. BeeTree adapts this for Georgia climate and beekeeper-friendly deployment."""
        },
        {
            "instruction": "What is a modulation tensorgram and why use it for bee audio?",
            "response": """Modulation tensorgrams for bee audio analysis:

**What is a modulation tensorgram?**
A modulation tensorgram is a time-frequency representation that captures how spectral energy changes over time. Unlike a simple spectrogram (which shows frequency content at each moment), a modulation tensorgram shows the *rate of change* of frequency bands — essentially "the frequencies of the frequencies."

**How it's computed:**
1. Take 60-second audio window at 16kHz
2. Compute short-time Fourier transform (STFT) → spectrogram
3. Apply modulation analysis across frequency bands
4. The result is a 2D tensor: modulation frequency × acoustic frequency
5. This captures temporal patterns that simple spectra miss

**Why it works for bees:**
- Bee hive audio is not random noise — it has temporal structure
- Worker activity, queen presence, and brood condition all create different modulation patterns
- A simple spectrogram averages out these temporal variations
- The modulation tensorgram preserves them, giving the ML model more information to discriminate colony states

**Advantages over raw spectrograms:**
- More compact (~44KB per 60s window vs ~960KB spectrogram)
- Better discrimination of colony states (validated in UrBAN dataset paper)
- Computationally efficient (can run on edge device like Pi 5)
- Preserves temporal dynamics that matter for biological signals

**The arXiv paper (2607.20386) showed:**
- CNN on modulation tensorgrams: ~75% accuracy on 3-class colony strength
- CRDNN (CNN + recurrent layers): slightly better, captures longer temporal context
- Both outperformed traditional MFCC features for deep learning approaches
- The tensorgram approach is the state-of-the-art for bee audio classification"""
        },
    ]
    return pairs

# ============================================================
# Part 4: Assemble and write the dataset
# ============================================================

def main():
    all_pairs = []
    
    # Load inspection data
    print("Loading 2021 inspections...")
    pairs_2021 = load_inspections_2021()
    all_pairs.extend(pairs_2021)
    print(f"  Generated {len(pairs_2021)} Q&A pairs from 2021 inspections")
    
    print("Loading 2022 inspections...")
    pairs_2022 = load_inspections_2022()
    all_pairs.extend(pairs_2022)
    print(f"  Generated {len(pairs_2022)} Q&A pairs from 2022 inspections")
    
    print("Loading beekeeping curriculum...")
    curriculum_pairs = generate_knowledge_base()
    all_pairs.extend(curriculum_pairs)
    print(f"  Generated {len(curriculum_pairs)} Q&A pairs from curriculum")
    
    print("Loading acoustic knowledge...")
    acoustic_pairs = generate_acoustic_knowledge()
    all_pairs.extend(acoustic_pairs)
    print(f"  Generated {len(acoustic_pairs)} Q&A pairs from acoustic knowledge")
    
    # Write as JSONL
    output_path = os.path.join(OUTPUT_DIR, "beetree_finetuning.jsonl")
    with open(output_path, "w") as f:
        for i, pair in enumerate(all_pairs):
            # Gemma format: instruction + input + response
            entry = {
                "id": f"beetree_{i:04d}",
                "instruction": pair["instruction"],
                "input": pair.get("input", ""),
                "response": pair["response"],
            }
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    
    print(f"\n✅ Wrote {len(all_pairs)} Q&A pairs to {output_path}")
    print(f"   File size: {os.path.getsize(output_path) / 1024:.1f} KB")
    
    # Also write a summary
    summary_path = os.path.join(OUTPUT_DIR, "dataset_summary.txt")
    with open(summary_path, "w") as f:
        f.write(f"BeeTree Fine-Tuning Dataset Summary\n")
        f.write(f"Generated: {datetime.now().isoformat()}\n")
        f.write(f"Total Q&A pairs: {len(all_pairs)}\n")
        f.write(f"  From 2021 inspections: {len(pairs_2021)}\n")
        f.write(f"  From 2022 inspections: {len(pairs_2022)}\n")
        f.write(f"  From curriculum: {len(curriculum_pairs)}\n")
        f.write(f"  From acoustic knowledge: {len(acoustic_pairs)}\n")
        f.write(f"\nFormat: JSONL with id, instruction, input, response fields\n")
        f.write(f"Target model: Gemma 4 E4B QAT (GGUF via Ollama)\n")
        f.write(f"License: CC BY 4.0 (UrBAN data) + BeeTree proprietary (curriculum/acoustic)\n")
    
    print(f"   Summary: {summary_path}")

if __name__ == "__main__":
    main()