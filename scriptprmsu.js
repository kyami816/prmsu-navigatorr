    /* ============================================
    PRMSU Campus Navigator - Enhanced Navigation
    Features: Turn-by-turn, Gyroscope, 3D Arrow
    ============================================ */

    // Application State
    const state = {
        user: '',
        campus: '',
            map: null,
        directionsService: null,
        directionsRenderer: null,
        markers: [],
        userMarker: null,
        otherUserMarkers: {},  // Store markers for other users in multiplayer
        pulsingCircles: [],  // Pulsing area-of-effect circles
        watchId: null,
        campusRouteCoords: [],
        routeGraph: null,
        walkableRoutePolylines: [],
        currentRoutePolyline: null,
        userToRouteConnector: null,  // Line from user location to nearest walkable route
        outsideRoutePolyline: null,
        userLocation: null,
        pendingDestination: null,  // Building selected but not yet navigating
        currentDestination: null,
        currentPath: [],
        currentStepIndex: 0,
        heading: 0,
        gyroEnabled: false,
        is3DNavigationMode: false,
        isFollowingUser: true,
        deviceOrientation: { alpha: 0, beta: 0, gamma: 0 },
        routeAnimationInterval: null,  // Stores arrow animation interval ID
        connectorAnimationInterval: null,  // Stores connector line animation interval ID
        navigationSteps: [],            // Stores all navigation steps
        currentStepInstructions: null,   // Current instruction data
        completedSteps: new Set(),       // Track completed steps
        isInstructionAnimating: false,
        lastRerouteAt: 0,
        lastRerouteLocation: null,
        userMarkerAnimFrameId: null,
        userMarkerAnimStart: null,
        userMarkerAnimEnd: null,
        userMarkerAnimStartTime: 0,
        lastUserIconUpdateAt: 0,
        lastUserIconRotation: null,
        locationPermissionConfirmed: false,
        cameraAnimFrameId: null,
        arrivalNotificationShown: false,
        originalDestination: null,
        currentHeatmapPolygons: []  // Store heatmap polygons for current building
    };

    function animateMapCamera(map, from, to, durationMs = 650) {
        if (!map) return;
        if (state.cameraAnimFrameId) {
            cancelAnimationFrame(state.cameraAnimFrameId);
            state.cameraAnimFrameId = null;
        }

        const startAt = performance.now();
        const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
        const lerp = (a, b, t) => a + (b - a) * t;
        const lerpAngle = (a, b, t) => {
            const delta = ((((b - a) % 360) + 540) % 360) - 180;
            return a + delta * t;
        };

        const step = (now) => {
            const tRaw = Math.min(1, (now - startAt) / durationMs);
            const t = easeInOut(tRaw);

            const center = {
                lat: lerp(from.center.lat, to.center.lat, t),
                lng: lerp(from.center.lng, to.center.lng, t)
            };

            map.moveCamera({
                center,
                zoom: lerp(from.zoom, to.zoom, t),
                tilt: lerp(from.tilt, to.tilt, t),
                heading: lerpAngle(from.heading, to.heading, t)
            });

            if (tRaw < 1) {
                state.cameraAnimFrameId = requestAnimationFrame(step);
            } else {
                state.cameraAnimFrameId = null;
            }
        };

        state.cameraAnimFrameId = requestAnimationFrame(step);
    }

    function animateUserMarkerTo(targetPos) {
        if (!state.userMarker) return;

        const currentPos = state.userMarker.getPosition();
        const start = currentPos
            ? { lat: currentPos.lat(), lng: currentPos.lng() }
            : { lat: targetPos.lat, lng: targetPos.lng };

        state.userMarkerAnimStart = start;
        state.userMarkerAnimEnd = { lat: targetPos.lat, lng: targetPos.lng };
        state.userMarkerAnimStartTime = performance.now();

        if (state.userMarkerAnimFrameId) {
            cancelAnimationFrame(state.userMarkerAnimFrameId);
            state.userMarkerAnimFrameId = null;
        }

        const DURATION_MS = 220;
        const step = () => {
            if (!state.userMarker || !state.userMarkerAnimStart || !state.userMarkerAnimEnd) return;
            const now = performance.now();
            const t = Math.min(1, (now - state.userMarkerAnimStartTime) / DURATION_MS);

            const lat = state.userMarkerAnimStart.lat + (state.userMarkerAnimEnd.lat - state.userMarkerAnimStart.lat) * t;
            const lng = state.userMarkerAnimStart.lng + (state.userMarkerAnimEnd.lng - state.userMarkerAnimStart.lng) * t;
            state.userMarker.setPosition({ lat, lng });

            if (t < 1) {
                state.userMarkerAnimFrameId = requestAnimationFrame(step);
            } else {
                state.userMarkerAnimFrameId = null;
            }
        };

        state.userMarkerAnimFrameId = requestAnimationFrame(step);
    }

    // Campus Configuration
    const CAMPUS_CONFIG = {
        main: {
            center: { lat: 15.3194, lng: 119.9830 },
            bounds: { north: 15.322, south: 15.316, east: 119.986, west: 119.981 },
            locations: [
                { name: "Dormitory", lat: 15.3170171, lng: 119.9836825, description: 'Student housing facility where university students can stay during the academic term.', image: "campus-images/main/DORMITORY.webp" },
                { name: "College of Communication and Information Technology", lat: 15.316957, lng: 119.9831708, description: 'Building for computer laboratories and classrooms for programming, networking, and information technology courses.', image: "campus-images/main/College of Communication and Information Technology.webp" },
                { name: "College of Industrial Technology", lat: 15.3176855, lng: 119.9835125, description: 'Academic and workshop building where students learn technical skills.', image: "campus-images/main/College of Industrial Technology.webp" },
                { name: "College of Engineering", lat: 15.3177298, lng: 119.9819898, description: 'Main facility for engineering programs where students attend lectures, laboratory classes, and engineering project activities.', image: "campus-images/main/College of Engineering.webp" },
                { name: "College of Physical Education", lat: 15.3179757, lng: 119.9823091, description: 'Academic building for physical education and sports science programs.', image: "campus-images/main/College of Physical Education.webp" },
                { name: "Gymnasium", lat: 15.3183912, lng: 119.9823315, description: 'Indoor sports facility used for physical education classes, sports events, competitions, and university programs.', image: "campus-images/main/GYMNASIUM.webp" },
                { name: "Science and Engineering Laboratory Building", lat: 15.3183834, lng: 119.9817887, description: 'Laboratory building used for science experiments and engineering practical activities.', image: "campus-images/main/Science and Engineering Laboratory Building.webp" },
                { name: "College of Accountancy & Business Administration", lat: 15.3192329, lng: 119.9823252, description: 'Building where business, accounting, marketing, and management classes are conducted.', image: "campus-images/main/College of Accountancy & Business Administration.webp" },
                { name: "College of Law", lat: 15.3190613, lng: 119.9830242, description: 'Facility where law students attend lectures, legal discussions, and academic activities related to legal education(Currently Out Of Order).', image: "campus-images/main/College of Law.webp" },
                { name: "Graduate School", lat: 15.3187705, lng: 119.9836655, description: 'Academic building for postgraduate programs including master\'s and doctoral studies.', image: "campus-images/main/Graduate School.webp" },
                { name: "President Ramon Magsaysay Statue", lat: 15.3185298, lng: 119.9837903, description: 'Campus landmark honoring President Ramon Magsaysay, the namesake of the university.', image: "campus-images/main/president-ramon-magsaysay-statue.webp" },
                { name: "President Ramon Magsaysay State University", lat: 15.318377, lng: 119.983605, description: 'Main campus area of PRMSU where most academic buildings and student facilities are located.', image: "campus-images/main/President Ramon Magsaysay State University.webp" },
                { name: "College of Arts & Science", lat: 15.3183856, lng: 119.9844414, description: 'Academic building offering programs in sciences, humanities, and social sciences.', image: "campus-images/main/College of Arts & Science.webp" },
                { name: "E-Library", lat: 15.3188057, lng: 119.9849515, description: 'Digital library where students can access computers, online research materials, and academic databases. Physical books are available at the 2nd floor of the building, and A ilibrary.', image: "campus-images/main/E-Library.webp" },
                { name: "Registrar Building", lat: 15.3187079, lng: 119.9843139, description: 'Office responsible for enrollment, student records, transcripts, and academic documentation.', image: "campus-images/main/Registrar Building.webp" },
                { name: "Clinic", lat: 15.31859, lng: 119.98413, description: 'Campus health center providing basic medical services and first aid for students and staff', image: "campus-images/main/Clinic.webp" },
                { name: "Quality Assurance Building", lat: 15.3191398, lng: 119.9839294, description: 'Office responsible for monitoring academic standards, program evaluation, and university accreditation.', image: "campus-images/main/Quality and Assurance Building.webp" },
                { name: "Back Gate", lat: 15.3166213, lng: 119.9833767, description: 'Secondary entrance and exit point of the university campus.', image: "campus-images/main/BACK GATE.webp" },
                { name: "COOP", lat: 15.3197159, lng: 119.984991, description: 'Campus cooperative store selling school supplies and other student necessities.', image: "campus-images/main/COOP.webp" },
                { name: "PRMSU Front Gate", lat: 15.3197927, lng: 119.9847305, description: 'Main entrance of the university where most students and visitors enter the campus.', image: "campus-images/main/PRMSU FRONT GATE.webp" },
                { name: "PRMSU Entrance", lat: 15.3218841, lng: 119.9852327, description: 'Primary access road leading into the university campus.', image: "campus-images/main/PRMSU ENTRANCE.webp" },
                { name: "Bachelor of Science in Nursing Building", lat: 15.317367, lng: 119.982432, description: 'Building where nursing students attend classes and practice clinical skills in training laboratories.', image: "campus-images/main/Collage of Nursing.webp" },
                { name: "ROTC Area", lat: 15.3191471, lng: 119.9826747, description: 'Training area for Reserve Officers\' Training Corps activities and military drills.', image: "campus-images/main/ROTC.webp" },
                { name: "College of Tourism and Hospitality Management", lat: 15.3196715, lng: 119.9840025, description: 'Academic building for tourism, hotel management, and hospitality programs.', image: "campus-images/main/College of Tourism and Hospitality Management.webp" },
                { name: "Cafeteria", lat: 15.3192502, lng: 119.9839457, description: 'Campus dining area where students and staff can buy food and beverages.', image: "campus-images/main/Cafeteria.webp" },
                { name: "Gender and Development Center", lat: 15.3195517, lng: 119.9841874, description: 'Office that promotes gender equality, awareness programs, and inclusive activities in the university.', image: "campus-images/main/Gender and Development Center.webp" },
                { name: "College of Arts & Science New Building", lat: 15.3190425, lng: 119.9846115, description: 'New facility providing additional classrooms and learning spaces for CAS programs.', image: "campus-images/main/College of Arts & Science New Building.webp" },
                { name: "College of Arts & Science Old Building", lat: 15.3181909, lng: 119.9846153, description: 'One of the original CAS buildings used for academic classes and activities.', image: "campus-images/main/College of Arts & Science Old Building.webp" },
                { name: "Automotive Building", lat: 15.3182780, lng: 119.9841103, description: 'Workshop facility for automotive technology training and vehicle maintenance practice.', image: "campus-images/main/Automotive Building.webp" },
                { name: "Drafting Building", lat: 15.3188054, lng: 119.9833788, description: 'Building used for drafting, technical drawing, and design classes.', image: "campus-images/main/Drafting Building.webp" },
                { name: "New Graduate School Building", lat: 15.3192067, lng: 119.9836192, description: 'Expanded facility for graduate school programs and postgraduate learning.', image: "campus-images/main/Graduate School.webp" },
                { name: "Laboratory High School", lat: 15.3190542, lng: 119.9854100, description: 'Secondary school within the campus that also serves as a training ground for education students.', image: "campus-images/main/High School.webp" },
                { name: "College of Teacher Education", lat: 15.31829, lng: 119.98494, description: 'Academic building where future teachers study education and teaching methods.', image: "campus-images/main/Collage of Teachers Education.webp" },
                { name: "Science Based Education Building", lat: 15.31866, lng: 119.98474, description: 'Facility supporting science education programs and laboratory-based teaching.', image: "campus-images/main/Science Based Education Building.webp" },
                { name: "Nursing Skills Laboratory Building", lat: 15.31693, lng: 119.98287, description: 'Specialized training facility where nursing students practice clinical and patient care procedures using simulation equipment and laboratory tools.', image: "campus-images/main/Nursings Skills Labolatory Building.webp" }
            ],
            cropCoords: [
                { lng: 119.9817441122205, lat: 15.319383724752853 },
                { lng: 119.98161124385598, lat: 15.318293726873293 },
                { lng: 119.98168035416722, lat: 15.317784640787167 },
                { lng: 119.98326071954239, lat: 15.316464068926194 },
                { lng: 119.98598191273817, lat: 15.319265966018179 },
                { lng: 119.98497421685647, lat: 15.31994029329097 },
                { lng: 119.98502912394036, lat: 15.320520900116506 },
                { lng: 119.98491644258547, lat: 15.321105507660022 },
                { lng: 119.98531601879733, lat: 15.32191263131621 },
                { lng: 119.98520844654848, lat: 15.321990735594724 },
                { lng: 119.98477954524952, lat: 15.321277054771855 },
                { lng: 119.98474719400639, lat: 15.320836963714768 },
                { lng: 119.98480762808055, lat: 15.320527329503065 },
                { lng: 119.98473889820013, lat: 15.32026231605964 },
                { lng: 119.98468822714489, lat: 15.320096586146349 },
                { lng: 119.984368285838, lat: 15.320303259776466 },
                { lng: 119.98404478621319, lat: 15.319994310737101 },
                { lng: 119.98316178334704, lat: 15.319517431833091 },
                { lng: 119.98288615542373, lat: 15.319329957042186 },
                { lng: 119.9817441122205, lat: 15.319383724752853 }
            ]
        },
        botolan: {
            center: { lat: 15.2470, lng: 120.0198 },
            bounds: { north: 15.2490, south: 15.2450, east: 120.0220, west: 120.0180 },
            locations: [
                { name: "PRMSU Botolan Gate", lat: 15.2482189, lng: 120.01923, description: "Main entrance gate to the Botolan campus. The primary access point for students, faculty, and visitors entering the campus. Features security and monitoring facilities.", image: "campus-images/botolan/Main%20Gate.webp" },
                { name: "PRMSU Botolan Dormitory", lat: 15.2484616, lng: 120.0201982, description: "Student residential facilities providing comfortable and secure accommodation for both male and female students. Equipped with modern amenities, dining areas, and recreational spaces to support student welfare.", image: "campus-images/botolan/Boys%20Dormitory.webp" },
                { name: "Canteen", lat: 15.2486751, lng: 120.0198884, description: "Campus dining facility serving affordable and nutritious meals for students and staff. Operates during school hours with various food options including local and international cuisines.", image: "campus-images/botolan/Campus%20Canteen.webp" },
                { name: "Clinic", lat: 15.2464664, lng: 120.0209487, description: "Health services facility providing medical care and health consultations for students and staff. Offers basic clinical services, health screening, and first aid treatment.", image: "campus-images/botolan/Academin%20building%28Clinic%20and%20Library%29.webp" },
                { name: "Library", lat: 15.2462956, lng: 120.0209889, description: "Campus library and learning resource center housing educational materials, books, journals, and digital resources. Provides a quiet study environment and supports academic research and learning.", image: "campus-images/botolan/Academin%20building%28Clinic%20and%20Library%29.webp" },
                { name: "Academic Building", lat: 15.2463758, lng: 120.0209219, description: "Multi-purpose academic facility housing classrooms, lecture halls, and instructional spaces. Equipped with modern teaching facilities supporting various academic programs and disciplines.", image: "campus-images/botolan/Academin%20building%28Clinic%20and%20Library%29.webp" },
                { name: "College of Teacher Education", lat: 15.2461973, lng: 120.0209111, description: "Professional education unit preparing prospective teachers through comprehensive pre-service education programs. Offers programs aligned with international educational standards and Philippine curriculum requirements.", image: "campus-images/botolan/College%20of%20Teacher%20Education.webp" },
                { name: "Extension and Training Office", lat: 15.2464379, lng: 120.0211954, description: "Office coordinating community outreach, extension services, and continuing professional development programs. Facilitates knowledge transfer and capacity building for communities and local industries.", image: "campus-images/botolan/Extention%20and%20Training%20Office.webp" },
                { name: "Covered Court", lat: 15.2463111, lng: 120.02071, description: "Multi-purpose indoor sports and events venue. Facilities for basketball, volleyball, badminton, and other indoor sports. Also used for assemblies, cultural events, and academic gatherings.", image: "campus-images/botolan/Covered%20Court.webp" },
                { name: "Administration Building", lat: 15.2460533, lng: 120.0205265, description: "Central administrative office complex housing campus management, finance, human resources, and strategic planning divisions. Coordinates all institutional administrative functions and operations.", image: "campus-images/botolan/Admin%20Building.webp" },
                { name: "Registrar's Office", lat: 15.2461284, lng: 120.0204501, description: "Office responsible for student records, registration, transcripts, and academic documentation. Processes admissions, enrollment, and degree conferment. Operates under University registrar policies.", image: "campus-images/botolan/Registrar's%20Office.webp" },
                { name: "Research Resource Center", lat: 15.2454127, lng: 120.0209797, description: "Facility supporting faculty and student research initiatives. Houses research computing resources, specialized equipment, and collaboration spaces for conducting institutional research and scholarship.", image: "campus-images/botolan/Research%20Resource%20Center.webp" },
                { name: "College of Agriculture and Forestry", lat: 15.2481335, lng: 120.0212539, description: "Academic unit offering comprehensive agricultural and forestry programs including crop production, animal husbandry, agribusiness, and natural resource management. Features experimental farms and training facilities.", image: "campus-images/botolan/College%20of%20Agriculture%20and%20Forestry.webp" },
                { name: "Ret Hall", lat: 15.2454324, lng: 120.0208546, description: "Multi-purpose events and retirement facility. Available for institutional functions, employee recognition programs, and community events. Equipped with modern amenities for gatherings.", image: "campus-images/botolan/Ret%20Office.webp" }
            ],
            cropCoords: [
                { lng: 120.0191654, lat: 15.2480784 },
                { lng: 120.0199916, lat: 15.2493412 },
                { lng: 120.0216545, lat: 15.2482026 },
                { lng: 120.0215472, lat: 15.2471364 },
                { lng: 120.0212898, lat: 15.2451697 },
                { lng: 120.0180604, lat: 15.2462358 },
                { lng: 120.0186612, lat: 15.2467534 },
                { lng: 120.0191654, lat: 15.2480784 }
            ]
        }
    };

    function getInstructionOutDirection(step) {
        if (!step || !step.instruction) return 'up';
        if (step.instruction.type === 'left') return 'left';
        if (step.instruction.type === 'right') return 'right';
        return 'up';
    }

    function advanceNavigationStep() {
        if (!state.navigationSteps || state.navigationSteps.length === 0) return;
        if (state.isInstructionAnimating) return;

        const currentStep = state.navigationSteps[0];
        const nextStep = state.navigationSteps.length > 1 ? state.navigationSteps[1] : null;
        const outDir = getInstructionOutDirection(currentStep);

        state.isInstructionAnimating = true;

        const instructionEl = document.getElementById('current-instruction');

        // Remove completed step permanently
        state.completedSteps.add(currentStep.index);
        state.navigationSteps.shift();
        renderSteps(state.navigationSteps);

        if (!instructionEl) {
            if (nextStep) updateCurrentInstruction(nextStep);
            state.isInstructionAnimating = false;
            return;
        }

        instructionEl.style.transition = 'transform 0.3s ease';
        if (outDir === 'left') instructionEl.style.transform = 'translateX(-100%)';
        else if (outDir === 'right') instructionEl.style.transform = 'translateX(100%)';
        else instructionEl.style.transform = 'translateY(-100%)';

        window.setTimeout(() => {
            if (nextStep) {
                const inDir = outDir === 'left' ? 'right' : outDir === 'right' ? 'left' : 'down';

                instructionEl.style.transition = 'none';
                if (inDir === 'left') instructionEl.style.transform = 'translateX(-100%)';
                else if (inDir === 'right') instructionEl.style.transform = 'translateX(100%)';
                else instructionEl.style.transform = 'translateY(100%)';

                void instructionEl.offsetWidth;

                updateCurrentInstruction(nextStep);
                state.currentStepInstructions = nextStep;

                instructionEl.style.transition = 'transform 0.3s ease';
                instructionEl.style.transform = 'translateX(0) translateY(0)';
            }

            window.setTimeout(() => {
                state.isInstructionAnimating = false;
            }, 300);
        }, 300);
    }

    function startRouteArrowAnimation() {
        if (!state.currentRoutePolyline || !window.google || !window.google.maps) return;

        stopRouteArrowAnimation();

        const arrowSymbol = {
            path: window.google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
            scale: 4,
            strokeColor: '#FFFFFF',
            strokeOpacity: 1,
            fillColor: '#FFFFFF',
            fillOpacity: 1
        };

        let offset = 0;
        const repeat = '80px';
        const polyline = state.currentRoutePolyline;

        polyline.setOptions({
            strokeColor: '#ADFF2F',
            strokeOpacity: 0.6,  // Reduced opacity to make arrows stand out
            strokeWeight: 5,  // Reduced weight to make arrows more visible
            icons: [{
                icon: arrowSymbol,
                offset: '0px',
                repeat: repeat
            }]
        });

        state.routeAnimationInterval = setInterval(() => {
            offset = (offset + 3) % 80;
            polyline.set('icons', [{
                icon: arrowSymbol,
                offset: `${offset}px`,
                repeat: repeat
            }]);
        }, 33);
    }

    function stopRouteArrowAnimation() {
        if (state.routeAnimationInterval) {
            clearInterval(state.routeAnimationInterval);
            state.routeAnimationInterval = null;
        }

        if (state.currentRoutePolyline) {
            state.currentRoutePolyline.set('icons', []);
            state.currentRoutePolyline.setOptions({
                strokeColor: '#ADFF2F',
                strokeOpacity: 0.6,  // Reduced opacity to make arrows stand out
                strokeWeight: 5  // Reduced weight for 3D mode
            });
        }
    }

    function startConnectorLineAnimation() {
        if (!state.userToRouteConnector || !window.google || !window.google.maps) return;

        stopConnectorLineAnimation();

        const arrowSymbol = {
            path: window.google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
            scale: 3,
            strokeColor: '#FFFFFF',
            strokeOpacity: 1,
            fillColor: '#FFFFFF',
            fillOpacity: 1
        };

        let offset = 0;
        const repeat = '60px';
        const polyline = state.userToRouteConnector;

        polyline.setOptions({
            strokeColor: '#FF9800',
            strokeOpacity: 0.8,
            strokeWeight: 4,
            strokeDasharray: [5, 5],
            icons: [{
                icon: arrowSymbol,
                offset: '0px',
                repeat: repeat
            }]
        });

        state.connectorAnimationInterval = setInterval(() => {
            offset = (offset + 3) % 60;
            polyline.set('icons', [{
                icon: arrowSymbol,
                offset: `${offset}px`,
                repeat: repeat
            }]);
        }, 33);
    }

    function stopConnectorLineAnimation() {
        if (state.connectorAnimationInterval) {
            clearInterval(state.connectorAnimationInterval);
            state.connectorAnimationInterval = null;
        }

        if (state.userToRouteConnector) {
            state.userToRouteConnector.set('icons', []);
            state.userToRouteConnector.setOptions({
                strokeColor: '#FF9800',
                strokeOpacity: 0.7,
                strokeWeight: 4,
                strokeDasharray: [5, 5]
            });
        }
    }

    // Campus route coordinates (walkable paths) - Full KML data
    // Main campus routes (empty - all routes now in ADDITIONAL_ROUTES)
    const CAMPUS_ROUTES = [];

    // All campus routes organized by segments
    const ADDITIONAL_ROUTES = [
  // 0 - PRMSU ARC TO GATE
  [
    { lat: 15.3218889, lng: 119.9852159 },
    { lat: 15.3214, lng: 119.9849423 },
    { lat: 15.3212926, lng: 119.98489 },
    { lat: 15.3212021, lng: 119.9848578 },
    { lat: 15.321127, lng: 119.9848511 },
    { lat: 15.3210585, lng: 119.9848484 },
    { lat: 15.3207403, lng: 119.9849141 },
    { lat: 15.320457, lng: 119.9849691 },
    { lat: 15.3204208, lng: 119.9849691 },
    { lat: 15.3203678, lng: 119.9849637 },
    { lat: 15.3202805, lng: 119.9849396 },
    { lat: 15.3202009, lng: 119.9848994 },
    { lat: 15.3200988, lng: 119.984835 },
    { lat: 15.3200548, lng: 119.9848135 },
    { lat: 15.3200043, lng: 119.9848028 },
    { lat: 15.3199384, lng: 119.9847921 },
    { lat: 15.3198996, lng: 119.9847854 },
    { lat: 15.3198595, lng: 119.9847693 },
    { lat: 15.3198025, lng: 119.9847357 },
  ],

  // 1 - GATE TO LONG ASS ROTONDA
  [
    { lat: 15.3198025, lng: 119.9847357 },
    { lat: 15.3196321, lng: 119.9846157 },
  ],

  // 2 - BEFORE UTURN N MAHABA
  [
    { lat: 15.3196321, lng: 119.9846157 },
    { lat: 15.3194618, lng: 119.9844691 },
  ],

  // 3 - OBLONG SA GITNA NG PRMSU (Polygon ring)
  [
    { lat: 15.3194186, lng: 119.9844359 },
    { lat: 15.3194245, lng: 119.9844177 },
    { lat: 15.3194193, lng: 119.9843963 },
    { lat: 15.3190736, lng: 119.9841228 },
    { lat: 15.3188657, lng: 119.9839571 },
    { lat: 15.318845, lng: 119.9839584 },
    { lat: 15.3188321, lng: 119.9839665 },
    { lat: 15.3188282, lng: 119.9839866 },
    { lat: 15.3188334, lng: 119.9840061 },
    { lat: 15.3190401, lng: 119.98417 },
    { lat: 15.3193844, lng: 119.9844466 },
    { lat: 15.3194038, lng: 119.9844453 },
    { lat: 15.3194186, lng: 119.9844359 },
  ],

  // 4 - GSOC TO ELIB TO ROTONDA
  [
    { lat: 15.3195704, lng: 119.9843163 },
    { lat: 15.3194618, lng: 119.9844691 },
    { lat: 15.3191255, lng: 119.9849358 },
    { lat: 15.3190017, lng: 119.984837 },
    { lat: 15.3188073, lng: 119.9846837 },
    { lat: 15.3188629, lng: 119.9846032 },
    { lat: 15.318784, lng: 119.9845389 },
    { lat: 15.3190401, lng: 119.98417 },
  ],

  // 5 - ELIB
  [
    { lat: 15.3190017, lng: 119.984837 },
    { lat: 15.3189422, lng: 119.9849189 },
  ],

  // 6 - Registrar to rotonda
  [
    { lat: 15.3189135, lng: 119.984354 },
    { lat: 15.3187867, lng: 119.9842547 },
    { lat: 15.3187557, lng: 119.9842306 },
    { lat: 15.318735, lng: 119.9842011 },
    { lat: 15.3187247, lng: 119.9841662 },
    { lat: 15.3187195, lng: 119.9841287 },
    { lat: 15.3187221, lng: 119.9840911 },
    { lat: 15.3187557, lng: 119.9839074 },
  ],

  // 7 - rotonda to ramon
  [
    { lat: 15.3188321, lng: 119.9839665 },
    { lat: 15.3187557, lng: 119.9839074 },
  ],

  // 8 - rotonda ramon bronze (Polygon ring)
  [
    { lat: 15.3187272, lng: 119.9838879 },
    { lat: 15.3187475, lng: 119.9837603 },
    { lat: 15.3186903, lng: 119.9836488 },
    { lat: 15.31857, lng: 119.9836287 },
    { lat: 15.3184627, lng: 119.9836863 },
    { lat: 15.3184394, lng: 119.9838117 },
    { lat: 15.3184989, lng: 119.983921 },
    { lat: 15.3186156, lng: 119.9839474 },
    { lat: 15.3187272, lng: 119.9838879 },
  ],

  // 9 - RAMON TO COL TO GYM
  [
    { lat: 15.3186903, lng: 119.9836488 },
    { lat: 15.3189296, lng: 119.9833001 },
    { lat: 15.3189659, lng: 119.9832223 },
    { lat: 15.3189891, lng: 119.9831445 },
    { lat: 15.319015, lng: 119.9830185 },
    { lat: 15.3190202, lng: 119.9828817 },
    { lat: 15.3190021, lng: 119.9827556 },
    { lat: 15.3189633, lng: 119.9826644 },
    { lat: 15.3189245, lng: 119.9826061 },
    { lat: 15.318874, lng: 119.9825504 },
    { lat: 15.3188184, lng: 119.9825068 },
    { lat: 15.3187589, lng: 119.9824659 },
    { lat: 15.3186735, lng: 119.982423 },
    { lat: 15.3185235, lng: 119.9823533 },
  ],

  // 10 - COL TO CTHM
  [
    { lat: 15.3189659, lng: 119.9832223 },
    { lat: 15.3191743, lng: 119.9833071 },
    { lat: 15.3193826, lng: 119.9834747 },
    { lat: 15.3194149, lng: 119.9835002 },
    { lat: 15.3196154, lng: 119.9839628 },
    { lat: 15.3196413, lng: 119.9840165 },
  ],

  // 11 - CAFE CONNECTOR
  [
    { lat: 15.3190736, lng: 119.9841228 },
    { lat: 15.3191628, lng: 119.983994 },
    { lat: 15.3190619, lng: 119.9839162 },
    { lat: 15.3192235, lng: 119.9836941 },
    { lat: 15.3193826, lng: 119.9834747 },
  ],

  // 12 - EWAN
  [
    { lat: 15.3186156, lng: 119.9839474 },
    { lat: 15.3185741, lng: 119.9840024 },
    { lat: 15.3184341, lng: 119.9841836 },
    { lat: 15.3183406, lng: 119.9843044 },
    { lat: 15.3182966, lng: 119.984342 },
    { lat: 15.3182397, lng: 119.9843742 },
    { lat: 15.318175, lng: 119.9843876 },
    { lat: 15.3181259, lng: 119.9843795 },
    { lat: 15.3179732, lng: 119.9842709 },
  ],

  // 13 - RAMON TO CIT TO CCIT TO BACKGATE
  [
    { lat: 15.3184989, lng: 119.983921 },
    { lat: 15.3184699, lng: 119.9839209 },
    { lat: 15.3184337, lng: 119.9839129 },
    { lat: 15.3184053, lng: 119.9838994 },
    { lat: 15.3180276, lng: 119.9836446 },
    { lat: 15.3179241, lng: 119.9835642 },
    { lat: 15.3177961, lng: 119.9834529 },
    { lat: 15.3176137, lng: 119.9832906 },
    { lat: 15.3172602, lng: 119.9830496 },
    { lat: 15.3170471, lng: 119.9829097 },
    { lat: 15.3168979, lng: 119.9830557 },
    { lat: 15.3167465, lng: 119.9832046 },
    { lat: 15.3165737, lng: 119.9833737 },
  ],

  // 14 - NURSING TO ENGR TO CBAPA
  [
    { lat: 15.3170471, lng: 119.9829097 },
    { lat: 15.3172318, lng: 119.9827055 },
    { lat: 15.3173576, lng: 119.9825664 },
    { lat: 15.3174119, lng: 119.9826174 },
    { lat: 15.3174973, lng: 119.9825154 },
    { lat: 15.3174429, lng: 119.9824685 },
    { lat: 15.3177999, lng: 119.9820615 },
    { lat: 15.3179758, lng: 119.981861 },
    { lat: 15.3179965, lng: 119.9818449 },
    { lat: 15.318025, lng: 119.9818395 },
    { lat: 15.3183626, lng: 119.9818583 },
    { lat: 15.3191555, lng: 119.9819039 },
    { lat: 15.3191969, lng: 119.9819441 },
    { lat: 15.3192227, lng: 119.9820031 },
    { lat: 15.3192227, lng: 119.9820729 },
    { lat: 15.319202, lng: 119.982148 },
    { lat: 15.3191525, lng: 119.9823003 },
    { lat: 15.3190021, lng: 119.9827556 },
  ],

  // 15 - GYM CONNECTOR CONSTRUCTION
  [
    { lat: 15.3172602, lng: 119.9830496 },
    { lat: 15.3176172, lng: 119.9826004 },
    { lat: 15.3176598, lng: 119.9825815 },
    { lat: 15.3177258, lng: 119.9825668 },
    { lat: 15.317872, lng: 119.9825534 },
    { lat: 15.3180169, lng: 119.9825507 },
    { lat: 15.318229, lng: 119.9825467 },
    { lat: 15.3186636, lng: 119.9825427 },
    { lat: 15.3188184, lng: 119.9825068 },
  ],

  // 16 - ADMIN CONNECTOR
  [
    { lat: 15.3184627, lng: 119.9836863 },
    { lat: 15.3184353, lng: 119.9836664 },
  ],

  // 17 - DORM CONNECTOR
  [
    { lat: 15.3167465, lng: 119.9832046 },
    { lat: 15.3171462, lng: 119.9835908 },
    { lat: 15.3171294, lng: 119.9836069 },
  ],

  // 18 - CCIT CONNECTOR
  [
    { lat: 15.3168979, lng: 119.9830557 },
    { lat: 15.3169535, lng: 119.9831121 },
  ],

  // 19 - NURSING CONNECTOR
  [
    { lat: 15.3172318, lng: 119.9827055 },
    { lat: 15.317215, lng: 119.9826894 },
  ],

  // 20 - ENGR GYM CONNECTOR
  [
    { lat: 15.3177662, lng: 119.9820996 },
    { lat: 15.3179098, lng: 119.982235 },
    { lat: 15.3179447, lng: 119.9822672 },
  ],

  // 21 - GYM ABOVE COURT CONNECTOR
  [
    { lat: 15.3179098, lng: 119.982235 },
    { lat: 15.3176172, lng: 119.9826004 },
  ],

  // 22 - CAS NEW BLDG TO COE
  [
    { lat: 15.3183406, lng: 119.9843044 },
    { lat: 15.3184476, lng: 119.9843908 },
    { lat: 15.3184925, lng: 119.9844262 },
    { lat: 15.3183218, lng: 119.9846582 },
    { lat: 15.3182416, lng: 119.9847695 },
    { lat: 15.3183677, lng: 119.9848688 },
    { lat: 15.3185585, lng: 119.9850217 },
    { lat: 15.3187271, lng: 119.9847942 },
    { lat: 15.3188073, lng: 119.9846837 },
  ],

  // 23 - CAS TO OLD CAS CONNECTOR
  [
    { lat: 15.3184925, lng: 119.9844262 },
    { lat: 15.3185494, lng: 119.9844718 },
    { lat: 15.3186956, lng: 119.9844718 },
    { lat: 15.318784, lng: 119.9845389 },
  ],

  // 24 - CAFE NEWGRAD TO RAMON CONNECTOR
  [
    { lat: 15.3190619, lng: 119.9839162 },
    { lat: 15.3188166, lng: 119.9837409 },
    { lat: 15.3187475, lng: 119.9837603 },
  ],

  // 25 - PRMSU COOP
  [
    { lat: 15.3194948, lng: 119.9848138 },
    { lat: 15.3196565, lng: 119.9849305 },
  ],

  // 26 - CTHM TO GENDER SOC CONNECTOR
  [
    { lat: 15.3195389, lng: 119.9839356 },
    { lat: 15.3193824, lng: 119.9841662 },
    { lat: 15.3195704, lng: 119.9843163 },
  ],

  // 27 - COE CONNECTOR
  [
    { lat: 15.3187271, lng: 119.9847942 },
    { lat: 15.3187142, lng: 119.9847835 },
  ],

  // 28 - CIT CONN GYM
  [
    { lat: 15.3176137, lng: 119.9832906 },
    { lat: 15.3176204, lng: 119.9827348 },
    { lat: 15.3177258, lng: 119.9825668 },
  ],

  // 29 - GATE TO JHS
  [
    { lat: 15.3196321, lng: 119.9846157 },
    { lat: 15.3194948, lng: 119.9848138 },
    { lat: 15.3193655, lng: 119.9850083 },
  ],

  // 30 - MAIN CONN
  [
    { lat: 15.3194618, lng: 119.9844691 },
    { lat: 15.3194186, lng: 119.9844359 },
  ],

  // 31 - CBAPA CONN
  [
    { lat: 15.3191566, lng: 119.982291 },
    { lat: 15.3191825, lng: 119.9823004 },
  ],

  // 32 - COL CONN
  [
    { lat: 15.319015, lng: 119.9830185 },
    { lat: 15.3190433, lng: 119.983022 },
  ],

  // 33 - COE CONN
  [
    { lat: 15.3183512, lng: 119.9848542 },
    { lat: 15.3183279, lng: 119.9848824 },
  ],

  // 34 - AUTOMOTIVE
  [
    { lat: 15.3184341, lng: 119.9841836 },
    { lat: 15.3183451, lng: 119.984169 },
  ],

  // 35 - MID CONN
  [
    { lat: 15.3187557, lng: 119.9839074 },
    { lat: 15.3187272, lng: 119.9838879 },
  ],

  // 36 - CLINIC CONN
  [
    { lat: 15.3185741, lng: 119.9840024 },
    { lat: 15.3186537, lng: 119.9840498 },
  ],

  // 37 - CIT TO CCIT CONN
  [
    { lat: 15.3171757, lng: 119.9829959 },
    { lat: 15.3170916, lng: 119.9830818 },
  ],

  // 38 - CLINIC TO REG CONN
  [
    { lat: 15.3186537, lng: 119.9840498 },
    { lat: 15.3187221, lng: 119.9840911 },
  ],

  // 39 - AUTOMOTIVE CONN TO CAS
  [
    { lat: 15.3184053, lng: 119.9838994 },
    { lat: 15.318418, lng: 119.9839207 },
    { lat: 15.3184231, lng: 119.9839382 },
    { lat: 15.318427, lng: 119.9839543 },
    { lat: 15.3184341, lng: 119.9841836 },
  ],

  // 40 - CLINIC ROTONDA CONN
  [
    { lat: 15.3187557, lng: 119.9839074 },
    { lat: 15.3186537, lng: 119.9840498 },
  ],

  // ✅ NEW from your latest KML split:
  // 41 - GATE TO CTHM (ends at canteen point)
  [
    { lat: 15.3196321, lng: 119.9846157 },
    { lat: 15.3198788, lng: 119.9842524 },
    { lat: 15.319884, lng: 119.984235 },
    { lat: 15.3198814, lng: 119.9842162 },
    { lat: 15.3198737, lng: 119.9841974 },
    { lat: 15.3196413, lng: 119.9840165 },
  ],

  // 42 - CTHM TO CANTEEN
  [
    { lat: 15.3196413, lng: 119.9840165 },
    { lat: 15.3195389, lng: 119.9839356 },
  ],

  // 43 - CTHM TO NEW GRAD
  [
    { lat: 15.3195389, lng: 119.9839356 },
    { lat: 15.3192235, lng: 119.9836941 },
  ],
  [
  { lat: 15.3177258, lng: 119.9825668 },
  { lat: 15.3179447, lng: 119.9822672 },
  ],

  // ===== BOTOLAN CAMPUS ROUTES =====
  // 32 - BOTOLAN ROUTE 1: Actual walking path from Gate area to Academic area
  [
    { lat: 15.24821, lng: 120.01927 },
    { lat: 15.24821, lng: 120.01928 },
    { lat: 15.24822, lng: 120.01931 },
    { lat: 15.24825, lng: 120.01936 },
    { lat: 15.24826, lng: 120.0194 },
    { lat: 15.2483, lng: 120.0195 },
    { lat: 15.24833, lng: 120.01961 },
    { lat: 15.24834, lng: 120.01966 },
    { lat: 15.24836, lng: 120.01972 },
    { lat: 15.24836, lng: 120.01976 },
    { lat: 15.24836, lng: 120.0198 },
    { lat: 15.24837, lng: 120.01983 },
    { lat: 15.24837, lng: 120.01985 },
    { lat: 15.24836, lng: 120.01987 },
    { lat: 15.24836, lng: 120.0199 },
    { lat: 15.24836, lng: 120.01993 },
    { lat: 15.24835, lng: 120.01996 },
    { lat: 15.24834, lng: 120.01999 },
    { lat: 15.24832, lng: 120.02003 },
    { lat: 15.24818, lng: 120.01999 },
    { lat: 15.24808, lng: 120.02 },
    { lat: 15.24797, lng: 120.02006 },
    { lat: 15.2479, lng: 120.02016 },
    { lat: 15.24782, lng: 120.02029 },
    { lat: 15.24778, lng: 120.02036 },
    { lat: 15.24776, lng: 120.0204 },
    { lat: 15.24768, lng: 120.02049 },
    { lat: 15.24757, lng: 120.02052 },
    { lat: 15.24741, lng: 120.02052 },
    { lat: 15.24721, lng: 120.02049 },
    { lat: 15.24695, lng: 120.02047 },
    { lat: 15.24694, lng: 120.02047 },
    { lat: 15.24677, lng: 120.02045 },
    { lat: 15.24675, lng: 120.02044 },
    { lat: 15.24665, lng: 120.02045 },
    { lat: 15.24659, lng: 120.02046 },
    { lat: 15.24655, lng: 120.02048 },
    { lat: 15.24635, lng: 120.02054 },
    { lat: 15.24615, lng: 120.02061 },
    { lat: 15.24597, lng: 120.0207 },
    { lat: 15.24581, lng: 120.02079 },
    { lat: 15.24572, lng: 120.0209 },
    { lat: 15.24574, lng: 120.02081 },
    { lat: 15.24574, lng: 120.02079 },
    { lat: 15.24574, lng: 120.02063 },
    { lat: 15.24575, lng: 120.02061 },
    { lat: 15.24574, lng: 120.02044 },
    { lat: 15.24575, lng: 120.02026 },
    { lat: 15.24577, lng: 120.02007 },
    { lat: 15.24579, lng: 120.01989 },
    { lat: 15.24581, lng: 120.0197 },
    { lat: 15.24583, lng: 120.01952 },
    { lat: 15.24584, lng: 120.0195 },
    { lat: 15.24588, lng: 120.01933 },
    { lat: 15.24589, lng: 120.01929 },
    { lat: 15.24594, lng: 120.01916 },
    { lat: 15.24596, lng: 120.01911 },
    { lat: 15.2461, lng: 120.01885 },
    { lat: 15.24611, lng: 120.01883 },
    { lat: 15.24619, lng: 120.01866 },
    { lat: 15.24624, lng: 120.01856 },
    { lat: 15.24627, lng: 120.0185 },
    { lat: 15.24636, lng: 120.01828 },
  ],

  // 33 - BOTOLAN ROUTE 2: Actual walking path connecting main nodes
  [
    { lat: 15.24832, lng: 120.02003 },
    { lat: 15.24831, lng: 120.02006 },
    { lat: 15.2483, lng: 120.02008 },
    { lat: 15.24828, lng: 120.02011 },
    { lat: 15.24822, lng: 120.02018 },
    { lat: 15.24819, lng: 120.02023 },
    { lat: 15.24818, lng: 120.02024 },
    { lat: 15.24813, lng: 120.02031 },
    { lat: 15.2481, lng: 120.02038 },
    { lat: 15.24809, lng: 120.02038 },
    { lat: 15.24806, lng: 120.02046 },
    { lat: 15.24804, lng: 120.0205 },
    { lat: 15.24802, lng: 120.02054 },
    { lat: 15.24801, lng: 120.02055 },
    { lat: 15.24798, lng: 120.02063 },
    { lat: 15.24794, lng: 120.0207 },
    { lat: 15.24791, lng: 120.02074 },
    { lat: 15.24788, lng: 120.02077 },
    { lat: 15.24786, lng: 120.02081 },
    { lat: 15.24782, lng: 120.02085 },
    { lat: 15.24779, lng: 120.02087 },
    { lat: 15.24777, lng: 120.02089 },
    { lat: 15.24774, lng: 120.02091 },
    { lat: 15.2477, lng: 120.02093 },
    { lat: 15.24766, lng: 120.02094 },
    { lat: 15.24763, lng: 120.02095 },
    { lat: 15.24758, lng: 120.02097 },
    { lat: 15.24753, lng: 120.02098 },
    { lat: 15.24749, lng: 120.021 },
    { lat: 15.24746, lng: 120.02102 },
    { lat: 15.24743, lng: 120.02104 },
    { lat: 15.2474, lng: 120.02106 },
    { lat: 15.24737, lng: 120.0211 },
    { lat: 15.24734, lng: 120.02114 },
    { lat: 15.24731, lng: 120.02119 },
    { lat: 15.24728, lng: 120.02123 },
    { lat: 15.24726, lng: 120.02127 },
    { lat: 15.24725, lng: 120.02128 },
    { lat: 15.24724, lng: 120.0213 },
    { lat: 15.24723, lng: 120.02133 },
    { lat: 15.24722, lng: 120.02137 },
    { lat: 15.24721, lng: 120.0214 },
    { lat: 15.24721, lng: 120.02143 },
    { lat: 15.2472, lng: 120.02146 },
    { lat: 15.24719, lng: 120.0215 },
    { lat: 15.24718, lng: 120.02153 },
    { lat: 15.24718, lng: 120.02154 },
  ],

  // 34 - BOTOLAN ROUTE 3: Line 21 (upper area)
  [
    { lat: 15.2479445, lng: 120.020697 },
    { lat: 15.2482007, lng: 120.0209706 },
    { lat: 15.2480584, lng: 120.021145 },
    { lat: 15.2477996, lng: 120.020862 },
  ],

  // 35 - BOTOLAN ROUTE 4: Line 22 (upper area)
  [
    { lat: 15.2457217, lng: 120.0208997 },
    { lat: 15.2456673, lng: 120.0210432 },
    { lat: 15.2454642, lng: 120.0209936 },
  ],

  // 36 - BOTOLAN ROUTE 5: Line 20
  [
    { lat: 15.2461463, lng: 120.0206077 },
    { lat: 15.2460867, lng: 120.0205112 },
  ],

  // 37 - BOTOLAN ROUTE 6: Line 21 (lower area)
  [
    { lat: 15.2464685, lng: 120.0205 },
    { lat: 15.2465112, lng: 120.0206516 },
    { lat: 15.2464491, lng: 120.0206663 },
  ],

  // 38 - BOTOLAN ROUTE 7: Line 22 (lower area)
  [
    { lat: 15.2463288, lng: 120.0207951 },
    { lat: 15.2463533, lng: 120.0208943 },
  ],

  // 39 - BOTOLAN ROUTE 8: Line 23
  [
    { lat: 15.2463935, lng: 120.0210472 },
    { lat: 15.2464258, lng: 120.0211679 },
  ],

  // 40 - BOTOLAN CONNECTOR 1: Little Route 1
  [
    { lat: 15.2464401, lng: 120.0206695 },
    { lat: 15.2463133, lng: 120.0207004 },
    { lat: 15.2463288, lng: 120.0207951 },
  ],

  // 41 - BOTOLAN CONNECTOR 2: Little Route 2
  [
    { lat: 15.2463533, lng: 120.0208943 },
    { lat: 15.2463935, lng: 120.0210472 },
  ],

  // 42 - BOTOLAN CONNECTOR 3: Little Route 3
  [
    { lat: 15.2483273, lng: 120.0200284 },
    { lat: 15.2484346, lng: 120.0200377 },
    { lat: 15.2486507, lng: 120.0199144 },
  ],

  // 43 - BOTOLAN CONNECTOR 4: Little Route 4
  [
    { lat: 15.2484346, lng: 120.0200377 },
    { lat: 15.2484916, lng: 120.0201651 },
  ],
];

    // ============================================
    // Utility Functions
    // ============================================

    // Haversine distance calculation (meters)
    function haversine(lat1, lng1, lat2, lng2) {
        const R = 6371000;
        const toRad = x => x * Math.PI / 180;
        const dLat = toRad(lat2 - lat1);
        const dLng = toRad(lng2 - lng1);
        const a = Math.sin(dLat/2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2) ** 2;
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    }

    // Calculate bearing between two points
    function calculateBearing(lat1, lng1, lat2, lng2) {
        const toRad = x => x * Math.PI / 180;
        const toDeg = x => x * 180 / Math.PI;
        const dLng = toRad(lng2 - lng1);
        const y = Math.sin(dLng) * Math.cos(toRad(lat2));
        const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
        return (toDeg(Math.atan2(y, x)) + 360) % 360;
    }

    // Get turn direction
    function getTurnDirection(currentBearing, nextBearing) {
        let diff = nextBearing - currentBearing;
        if (diff > 180) diff -= 360;
        if (diff < -180) diff += 360;
        
        if (Math.abs(diff) < 20) return { type: 'straight', text: 'Continue straight', icon: 'up' };
        if (diff > 0 && diff <= 60) return { type: 'slight-right', text: 'Turn slightly right', icon: 'right-up' };
        if (diff > 60 && diff <= 120) return { type: 'right', text: 'Turn right', icon: 'right' };
        if (diff > 120) return { type: 'sharp-right', text: 'Turn sharp right', icon: 'right-down' };
        if (diff < 0 && diff >= -60) return { type: 'slight-left', text: 'Turn slightly left', icon: 'left-up' };
        if (diff < -60 && diff >= -120) return { type: 'left', text: 'Turn left', icon: 'left' };
        return { type: 'sharp-left', text: 'Turn sharp left', icon: 'left-down' };
    }

    // Format distance
    function formatDistance(meters) {
        if (meters < 1000) return `${Math.round(meters)} m`;
        return `${(meters / 1000).toFixed(2)} km`;
    }

    // Build route graph from coordinates
    // IMPORTANT: CAMPUS_ROUTES is a SEQUENCE of connected points forming walkable paths
    // Each point only connects to its immediate neighbors to avoid shortcutting
    function buildRouteGraph(routeSegments) {
    const graph = {};
    const allCoords = [];
    const segmentInfo = []; // {segmentIdx, coordIdx, isEndpoint}
    const nodeSegmentEndpoints = new Set(); // node indices that are endpoints

    // ✅ Tune these (optimized for better pathfinding)
    const MERGE_TOLERANCE_M = 3.5;     // points closer than this become the SAME node
    const JUNCTION_TOLERANCE_M = 15.0;  // endpoints closer than this become CONNECTED (increased for better connectivity)
    const INTERMEDIATE_CONNECTION_TOLERANCE_M = 12.0; // intermediate points closer than this also connect (for shortcuts)

    // Find existing node within tolerance, else create new
    function getOrCreateNode(coord, meta) {
        for (let i = 0; i < allCoords.length; i++) {
        const d = haversine(coord.lat, coord.lng, allCoords[i].lat, allCoords[i].lng);
        if (d <= MERGE_TOLERANCE_M) {
            // existing node
            segmentInfo[i] = segmentInfo[i] || meta;
            if (meta.isEndpoint) nodeSegmentEndpoints.add(i);
            return i;
        }
        }

        // new node
        const idx = allCoords.length;
        allCoords.push({ lat: coord.lat, lng: coord.lng });
        segmentInfo[idx] = meta;
        graph[idx] = [];
        if (meta.isEndpoint) nodeSegmentEndpoints.add(idx);
        return idx;
    }

    function connect(a, b) {
        if (a === undefined || b === undefined || a === b) return;
        const dist = haversine(allCoords[a].lat, allCoords[a].lng, allCoords[b].lat, allCoords[b].lng);
        if (!graph[a].some(e => e.node === b)) graph[a].push({ node: b, distance: dist });
        if (!graph[b].some(e => e.node === a)) graph[b].push({ node: a, distance: dist });
    }

    // 1) Build nodes + connect sequential neighbors inside each segment
    routeSegments.forEach((segment, sIdx) => {
        let prevNode = null;
        for (let cIdx = 0; cIdx < segment.length; cIdx++) {
        const isEndpoint = (cIdx === 0 || cIdx === segment.length - 1);
        const node = getOrCreateNode(segment[cIdx], { segmentIdx: sIdx, coordIdx: cIdx, isEndpoint });

        if (prevNode !== null) connect(prevNode, node);
        prevNode = node;
        }
    });

    // 2) Connect segment endpoints that are close to each other (junctions)
    const endpointNodes = Array.from(nodeSegmentEndpoints);

    for (let i = 0; i < endpointNodes.length; i++) {
        for (let j = i + 1; j < endpointNodes.length; j++) {
        const a = endpointNodes[i];
        const b = endpointNodes[j];

        // Don't connect endpoints from same segment unless they are truly identical/close
        if (
            segmentInfo[a] &&
            segmentInfo[b] &&
            segmentInfo[a].segmentIdx === segmentInfo[b].segmentIdx
        ) continue;

        const d = haversine(allCoords[a].lat, allCoords[a].lng, allCoords[b].lat, allCoords[b].lng);
        if (d <= JUNCTION_TOLERANCE_M) connect(a, b);
        }
    }

    // 2.5) Also connect intermediate points that are close (for shortcuts through openings)
    // This allows the algorithm to find shorter paths through building openings
    // Check all points but optimize by skipping already-connected pairs
    for (let i = 0; i < allCoords.length; i++) {
        for (let j = i + 1; j < allCoords.length; j++) {
        // Skip if already connected (sequential neighbors or previous connections)
        if (graph[i].some(e => e.node === j)) continue;
        
        // Skip if from same segment (already connected sequentially)
        if (
            segmentInfo[i] &&
            segmentInfo[j] &&
            segmentInfo[i].segmentIdx === segmentInfo[j].segmentIdx
        ) continue;

        const d = haversine(allCoords[i].lat, allCoords[i].lng, allCoords[j].lat, allCoords[j].lng);
        // Connect intermediate points that are close (for shortcuts/openings)
        // This creates direct paths through building openings instead of going around
        if (d <= INTERMEDIATE_CONNECTION_TOLERANCE_M) {
            connect(i, j);
        }
        }
    }

    // 3) Debug: components count
    const visited = new Set();
    let components = 0;
    function dfs(n) {
        if (visited.has(n)) return;
        visited.add(n);
        for (const e of graph[n]) dfs(e.node);
    }
    for (let i = 0; i < allCoords.length; i++) {
        if (!visited.has(i)) {
        components++;
        dfs(i);
        }
    }
    console.log('[GRAPH] Components:', components, 'Nodes:', allCoords.length);

    return { graph, allCoords };
    }


    // Simplify path by removing loops and redundant segments
    // This ensures we only have ONE continuous route without branches
    // Uses coordinate-based detection to catch loops even when same coordinates have different indices
    function simplifyPath(pathIndices, coords) {
        if (pathIndices.length <= 2) return pathIndices;
        
        // Remove duplicate consecutive indices
        const cleaned = [pathIndices[0]];
        for (let i = 1; i < pathIndices.length; i++) {
            if (pathIndices[i] !== pathIndices[i - 1]) {
                cleaned.push(pathIndices[i]);
            }
        }
        
        if (cleaned.length <= 2) return cleaned;
        
        // For connectors, we should NOT use proximity-based loop detection
        // Each node has a unique index, and connectors may come close to main routes
        // Just remove exact duplicate indices, nothing more
        // This preserves legitimate connector segments that branch off and return
        
        console.log('[SIMPLIFY] Path kept at', cleaned.length, 'nodes (exact duplicates removed, proximity-based removal disabled for connectors)');
        return cleaned;
    }

    // Dijkstra's algorithm
    function dijkstra(graph, start, end) {
        if (start === end) {
            console.log('[DIJKSTRA] Start equals end, returning single node');
            return [start];
        }
        if (!graph || !graph[start] || !graph[end]) {
            console.error('[DIJKSTRA] Invalid graph or nodes - graph exists:', !!graph, 'start exists:', !!graph?.[start], 'end exists:', !!graph?.[end]);
            return [];
        }
        
        const distances = {};
        const previous = {};
        const unvisited = new Set();
        
        for (let node in graph) {
            distances[node] = Infinity;
            unvisited.add(parseInt(node));
        }
        distances[start] = 0;
        
        while (unvisited.size > 0) {
            let current = null;
            let minDist = Infinity;
            for (let node of unvisited) {
                if (distances[node] < minDist) {
                    minDist = distances[node];
                    current = node;
                }
            }
            if (current === null || distances[current] === Infinity) break;
            unvisited.delete(current);
            
            for (let neighbor of graph[current]) {
                const alt = distances[current] + neighbor.distance;
                if (alt < distances[neighbor.node]) {
                    distances[neighbor.node] = alt;
                    previous[neighbor.node] = current;
                }
            }
        }
        
        const path = [];
        let current = end;
        while (current !== undefined) {
            path.unshift(current);
            current = previous[current];
        }
        console.log('[DIJKSTRA] Path found with', path.length, 'nodes, distance:', distances[end], 'meters');
        return path.length > 1 ? path : [];
    }

    // Find closest route point with smart fallback
    // MAX_CONNECTION_DISTANCE: Maximum distance (meters) a location can be from a route point to be considered reachable
    function findClosestRoutePointRobust(lat, lng, coords, maxConnectionDistance = 40) {
        let closest = 0;
        let minDist = Infinity;
        
        // Always find the single closest point
        coords.forEach((coord, idx) => {
            const dist = haversine(lat, lng, coord.lat, coord.lng);
            if (dist < minDist) {
                minDist = dist;
                closest = idx;
            }
        });
        
        // If closest point is too far, return empty (location not reachable via walkable routes)
        if (minDist > maxConnectionDistance) {
            console.warn(`[ROUTING] Location too far from routes: ${minDist.toFixed(2)}m (max: ${maxConnectionDistance}m)`);
            return []; // Return empty - not reachable via defined routes
        }
        
        // Find nearby alternatives - expand search radius to find better entry/exit points
        // This helps find shorter paths by considering multiple route segments
        const candidates = [closest];
        // Increased search radius to find more candidate points for better pathfinding
        const MAX_SEARCH_RADIUS = Math.min(maxConnectionDistance * 1.5, Math.max(60, minDist + 40)); // Expanded search radius
        
        coords.forEach((coord, idx) => {
            if (idx === closest) return;
            
            const dist = haversine(lat, lng, coord.lat, coord.lng);
            // Include points within the search radius, prioritizing closer ones
            if (dist <= MAX_SEARCH_RADIUS) {
                candidates.push(idx);
            }
        });
        
        // Sort by distance and limit to top candidates
        candidates.sort((a, b) => {
            const distA = haversine(lat, lng, coords[a].lat, coords[a].lng);
            const distB = haversine(lat, lng, coords[b].lat, coords[b].lng);
            return distA - distB;
        });
        
        // Return top candidates (closest first)
        // Increased limit to find better paths
        return candidates.slice(0, 20); // Increased from 10 to 20 candidates for better pathfinding
    }

    // Check if point is inside campus bounds
    function isInsideCampus(lat, lng) {
        const bounds = CAMPUS_CONFIG[state.campus].bounds;
        return lat >= bounds.south && lat <= bounds.north && lng >= bounds.west && lng <= bounds.east;
    }

    // Building abbreviations mapping
    const BUILDING_ABBREVIATIONS = {
        'ccit': 'College of Communication and Information Technology',
        'cit': 'College of Industrial Technology',
        'coe': 'College of Engineering',
        'cpe': 'College of Physical Education',
        'caba': 'College of Accountancy & Business Administration',
        'col': 'College of Law',
        'cas': 'College of Arts & Science',
        'cthm': 'College of Tourism and Hospitality Management'
    };

    // Gate locations for routing users from outside campus
    const CAMPUS_GATES = {
        main: [
            { name: "PRMSU FRONT GATE", lat: 15.3197927, lng: 119.9847305 },
            { name: "PRMSU ENTRANCE", lat: 15.3218841, lng: 119.9852327 },
            { name: "PRMSU BACK GATE", lat: 15.3166213, lng: 119.9833767 }
        ],
        botolan: [
            { name: "PRMSU Botolan Gate", lat: 15.2482189, lng: 120.01923 }
        ]
    };

    // Building footprint heatmap data for Iba campus
    const BUILDING_HEATMAPS = {
        "College of Communication and Information Technology": {
            parts: [
                [
                    { lat: 15.3169615, lng: 119.9833413 },
                    { lat: 15.3171529, lng: 119.9831415 },
                    { lat: 15.3170921, lng: 119.9830784 },
                    { lat: 15.3170792, lng: 119.9830905 },
                    { lat: 15.3170404, lng: 119.9830516 },
                    { lat: 15.3169783, lng: 119.9831120 },
                    { lat: 15.3169628, lng: 119.9830972 },
                    { lat: 15.3169382, lng: 119.9831254 },
                    { lat: 15.3169511, lng: 119.9831388 },
                    { lat: 15.3168580, lng: 119.9832380 },
                    { lat: 15.3169615, lng: 119.9833413 }
                ],
                [
                    { lat: 15.3173852, lng: 119.9824888 },
                    { lat: 15.3176788, lng: 119.9821616 },
                    { lat: 15.3175896, lng: 119.9820757 },
                    { lat: 15.3172986, lng: 119.9824057 },
                    { lat: 15.3173852, lng: 119.9824888 }
                ]
            ]
        },
        "PRMSU Dormitory": {
            parts: [[
                { lat: 15.3173194, lng: 119.9838574 },
                { lat: 15.3171306, lng: 119.9836710 },
                { lat: 15.3171474, lng: 119.9836509 },
                { lat: 15.3170931, lng: 119.9836026 },
                { lat: 15.3170762, lng: 119.9836200 },
                { lat: 15.3168874, lng: 119.9834349 },
                { lat: 15.3167632, lng: 119.9835650 },
                { lat: 15.3172004, lng: 119.9839848 },
                { lat: 15.3173194, lng: 119.9838574 }
            ]]
        },
        "College of Industrial Technology": {
            parts: [
                [
                    { lat: 15.3176659, lng: 119.9834365 },
                    { lat: 15.3176089, lng: 119.9838348 },
                    { lat: 15.3177344, lng: 119.9838509 },
                    { lat: 15.3177887, lng: 119.9834539 },
                    { lat: 15.3176659, lng: 119.9834365 }
                ],
                [
                    { lat: 15.3179836, lng: 119.9836107 },
                    { lat: 15.3178582, lng: 119.9835866 },
                    { lat: 15.3177948, lng: 119.9839943 },
                    { lat: 15.3179254, lng: 119.9840130 },
                    { lat: 15.3179836, lng: 119.9836107 }
                ],
                [
                    { lat: 15.3181184, lng: 119.9841635 },
                    { lat: 15.3181649, lng: 119.9837504 },
                    { lat: 15.3180446, lng: 119.9837343 },
                    { lat: 15.3179955, lng: 119.9841501 },
                    { lat: 15.3181184, lng: 119.9841635 }
                ],
                [
                    { lat: 15.3183018, lng: 119.9843032 },
                    { lat: 15.3183625, lng: 119.9838955 },
                    { lat: 15.3182474, lng: 119.9838767 },
                    { lat: 15.3181802, lng: 119.9842858 },
                    { lat: 15.3183018, lng: 119.9843032 }
                ],
                [
                    { lat: 15.3188687, lng: 119.9833535 },
                    { lat: 15.3187769, lng: 119.9832838 },
                    { lat: 15.3186682, lng: 119.9834273 },
                    { lat: 15.3187497, lng: 119.9834876 },
                    { lat: 15.3188273, lng: 119.9833830 },
                    { lat: 15.3188415, lng: 119.9833937 },
                    { lat: 15.3188687, lng: 119.9833535 }
                ]
            ]
        },
        "College of Tourism and Hospitality Management": {
            parts: [
                [
                    { lat: 15.3198871, lng: 119.9839839 },
                    { lat: 15.3197798, lng: 119.9837398 },
                    { lat: 15.3196168, lng: 119.9838149 },
                    { lat: 15.3196466, lng: 119.9838860 },
                    { lat: 15.3196090, lng: 119.9839047 },
                    { lat: 15.3196491, lng: 119.9840013 },
                    { lat: 15.3196892, lng: 119.9839825 },
                    { lat: 15.3197216, lng: 119.9840576 },
                    { lat: 15.3198871, lng: 119.9839839 }
                ],
                [
                    { lat: 15.3193019, lng: 119.9849807 },
                    { lat: 15.3198594, lng: 119.9842203 },
                    { lat: 15.3197572, lng: 119.9841452 },
                    { lat: 15.3192049, lng: 119.9849123 },
                    { lat: 15.3193019, lng: 119.9849807 }
                ]
            ]
        },
        "College of Teacher Education": {
            parts: [
                [
                    { lat: 15.3185897, lng: 119.9851216 },
                    { lat: 15.3182145, lng: 119.9848185 },
                    { lat: 15.3181473, lng: 119.9849044 },
                    { lat: 15.3185198, lng: 119.9852074 },
                    { lat: 15.3185897, lng: 119.9851216 }
                ],
                [
                    { lat: 15.3185741, lng: 119.9849532 },
                    { lat: 15.3188121, lng: 119.9846381 },
                    { lat: 15.3187409, lng: 119.9845844 },
                    { lat: 15.3187513, lng: 119.9845697 },
                    { lat: 15.3186737, lng: 119.9845053 },
                    { lat: 15.3186142, lng: 119.9845885 },
                    { lat: 15.3186814, lng: 119.9846435 },
                    { lat: 15.3185469, lng: 119.9848245 },
                    { lat: 15.3184797, lng: 119.9847735 },
                    { lat: 15.3184176, lng: 119.9848553 },
                    { lat: 15.3185003, lng: 119.9849197 },
                    { lat: 15.3185120, lng: 119.9849050 },
                    { lat: 15.3185741, lng: 119.9849532 }
                ]
            ]
        },
        "Bachelor of Science in Nursing": {
            parts: [[
                { lat: 15.3173683, lng: 119.9825097 },
                { lat: 15.3172765, lng: 119.9824272 },
                { lat: 15.3169673, lng: 119.9827759 },
                { lat: 15.3170566, lng: 119.9828590 },
                { lat: 15.3173683, lng: 119.9825097 }
            ]]
        },
        "College of Engineering": {
            parts: [[
                { lat: 15.3178028, lng: 119.9818394 },
                { lat: 15.3176049, lng: 119.9820607 },
                { lat: 15.3176851, lng: 119.9821331 },
                { lat: 15.3178080, lng: 119.9819949 },
                { lat: 15.3178274, lng: 119.9820164 },
                { lat: 15.3178817, lng: 119.9819561 },
                { lat: 15.3178727, lng: 119.9819467 },
                { lat: 15.3178882, lng: 119.9819293 },
                { lat: 15.3178028, lng: 119.9818394 }
            ]]
        },
        "President Ramon Magsaysay State University": {
            parts: [[
                { lat: 15.3185584, lng: 119.9834915 },
                { lat: 15.3184225, lng: 119.9833815 },
                { lat: 15.3182014, lng: 119.9836860 },
                { lat: 15.3183398, lng: 119.9837852 },
                { lat: 15.3185584, lng: 119.9834915 }
            ]]
        },
        "College of Accountancy & Business Administration": {
            parts: [[
                { lat: 15.3192508, lng: 119.9825459 },
                { lat: 15.3193207, lng: 119.9821784 },
                { lat: 15.3192883, lng: 119.9821717 },
                { lat: 15.3192948, lng: 119.9821302 },
                { lat: 15.3192431, lng: 119.9821168 },
                { lat: 15.3192340, lng: 119.9821610 },
                { lat: 15.3192172, lng: 119.9821570 },
                { lat: 15.3191448, lng: 119.9825325 },
                { lat: 15.3191642, lng: 119.9825352 },
                { lat: 15.3191525, lng: 119.9825875 },
                { lat: 15.3192069, lng: 119.9825969 },
                { lat: 15.3192185, lng: 119.9825419 },
                { lat: 15.3192508, lng: 119.9825459 }
            ]]
        },
        "PRMSU Cafeteria": {
            parts: [[
                { lat: 15.3194407, lng: 119.9839869 },
                { lat: 15.3191820, lng: 119.9837844 },
                { lat: 15.3190850, lng: 119.9839145 },
                { lat: 15.3191277, lng: 119.9839467 },
                { lat: 15.3191341, lng: 119.9839359 },
                { lat: 15.3193527, lng: 119.9841130 },
                { lat: 15.3194407, lng: 119.9839869 }
            ]]
        },
        "PRMSU Gymnasium": {
            parts: [[
                { lat: 15.3184727, lng: 119.9824850 },
                { lat: 15.3184598, lng: 119.9821538 },
                { lat: 15.3179579, lng: 119.9821551 },
                { lat: 15.3179657, lng: 119.9824891 },
                { lat: 15.3184727, lng: 119.9824850 }
            ]]
        },
        "College of Physical Education": {
            parts: [[
                { lat: 15.3184727, lng: 119.9824850 },
                { lat: 15.3184598, lng: 119.9821538 },
                { lat: 15.3179579, lng: 119.9821551 },
                { lat: 15.3179657, lng: 119.9824891 },
                { lat: 15.3184727, lng: 119.9824850 }
            ]]
        },
        "PRMSU Registrar Building": {
            parts: [[
                { lat: 15.3188626, lng: 119.9843631 },
                { lat: 15.3186751, lng: 119.9842169 },
                { lat: 15.3185962, lng: 119.9843215 },
                { lat: 15.3187876, lng: 119.9844636 },
                { lat: 15.3188626, lng: 119.9843631 }
            ]]
        },
        "Science and Engineering Laboratory Building": {
            parts: [[
                { lat: 15.3183227, lng: 119.9818345 },
                { lat: 15.3184456, lng: 119.9818425 },
                { lat: 15.3185025, lng: 119.9818586 },
                { lat: 15.3185529, lng: 119.9818667 },
                { lat: 15.3186059, lng: 119.9818680 },
                { lat: 15.3186538, lng: 119.9818627 },
                { lat: 15.3186926, lng: 119.9818479 },
                { lat: 15.3186913, lng: 119.9818667 },
                { lat: 15.3188090, lng: 119.9818734 },
                { lat: 15.3188336, lng: 119.9818452 },
                { lat: 15.3191466, lng: 119.9818694 },
                { lat: 15.3191557, lng: 119.9817513 },
                { lat: 15.3183279, lng: 119.9817125 },
                { lat: 15.3183227, lng: 119.9818345 }
            ]]
        },
        "College of Law": {
            parts: [[
                { lat: 15.3191422, lng: 119.9832258 },
                { lat: 15.3192185, lng: 119.9828302 },
                { lat: 15.3191034, lng: 119.9828021 },
                { lat: 15.3190167, lng: 119.9832004 },
                { lat: 15.3191422, lng: 119.9832258 }
            ]]
        },
        "gensoc": {
            parts: [[
                { lat: 15.3197097, lng: 119.9841691 },
                { lat: 15.3195325, lng: 119.9840323 },
                { lat: 15.3194420, lng: 119.9841544 },
                { lat: 15.3195053, lng: 119.9842013 },
                { lat: 15.3194898, lng: 119.9842214 },
                { lat: 15.3196114, lng: 119.9843059 },
                { lat: 15.3197097, lng: 119.9841691 }
            ]]
        },
        "College of Arts & Science New Building": {
            parts: [[
                { lat: 15.3192401, lng: 119.9846454 },
                { lat: 15.3189142, lng: 119.9843879 },
                { lat: 15.3188482, lng: 119.9844765 },
                { lat: 15.3191677, lng: 119.9847366 },
                { lat: 15.3192401, lng: 119.9846454 }
            ]]
        },
        "PRMSU E-Library": {
            parts: [[
                { lat: 15.3190504, lng: 119.9850261 },
                { lat: 15.3189871, lng: 119.9849765 },
                { lat: 15.3189612, lng: 119.9850114 },
                { lat: 15.3188810, lng: 119.9849483 },
                { lat: 15.3188926, lng: 119.9849349 },
                { lat: 15.3188409, lng: 119.9848947 },
                { lat: 15.3188176, lng: 119.9848840 },
                { lat: 15.3187956, lng: 119.9848840 },
                { lat: 15.3187788, lng: 119.9848907 },
                { lat: 15.3187659, lng: 119.9849068 },
                { lat: 15.3187374, lng: 119.9848826 },
                { lat: 15.3186792, lng: 119.9849577 },
                { lat: 15.3186650, lng: 119.9849443 },
                { lat: 15.3186262, lng: 119.9849979 },
                { lat: 15.3188293, lng: 119.9851630 },
                { lat: 15.3188577, lng: 119.9851240 },
                { lat: 15.3189340, lng: 119.9851830 },
                { lat: 15.3190504, lng: 119.9850261 }
            ]]
        },
        "College of Arts & Science Old Building": {
            parts: [[
                { lat: 15.3181662, lng: 119.9848058 },
                { lat: 15.3184042, lng: 119.9844946 },
                { lat: 15.3183176, lng: 119.9844235 },
                { lat: 15.3180757, lng: 119.9847374 },
                { lat: 15.3181662, lng: 119.9848058 }
            ]]
        },
        "PRMSU Clinic": {
            parts: [[
                { lat: 15.3184195, lng: 119.9842673 },
                { lat: 15.3185230, lng: 119.9843491 },
                { lat: 15.3186730, lng: 119.9841533 },
                { lat: 15.3186394, lng: 119.9841278 },
                { lat: 15.3186523, lng: 119.9841104 },
                { lat: 15.3186122, lng: 119.9840795 },
                { lat: 15.3186006, lng: 119.9840956 },
                { lat: 15.3185644, lng: 119.9840688 },
                { lat: 15.3184195, lng: 119.9842673 }
            ]]
        },
        "PRMSU Automotive Building": {
            parts: [[
                { lat: 15.3183018, lng: 119.9843032 },
                { lat: 15.3183625, lng: 119.9838955 },
                { lat: 15.3182474, lng: 119.9838767 },
                { lat: 15.3181802, lng: 119.9842858 },
                { lat: 15.3183018, lng: 119.9843032 }
            ]]
        },
        "PRMSU Drafting Building": {
            parts: [[
                { lat: 15.3188687, lng: 119.9833535 },
                { lat: 15.3187769, lng: 119.9832838 },
                { lat: 15.3186682, lng: 119.9834273 },
                { lat: 15.3187497, lng: 119.9834876 },
                { lat: 15.3188273, lng: 119.9833830 },
                { lat: 15.3188415, lng: 119.9833937 },
                { lat: 15.3188687, lng: 119.9833535 }
            ]]
        },
        "PRMSU New Graduate School Building": {
            parts: [[
                { lat: 15.3191611, lng: 119.9837681 },
                { lat: 15.3193447, lng: 119.9835186 },
                { lat: 15.3192516, lng: 119.9834476 },
                { lat: 15.3190692, lng: 119.9837024 },
                { lat: 15.3191611, lng: 119.9837681 }
            ]]
        },
        "PRMSU Laboratory Highschool": {
            parts: [[
                { lat: 15.3193952, lng: 119.9850324 },
                { lat: 15.3193150, lng: 119.9849734 },
                { lat: 15.3189710, lng: 119.9854522 },
                { lat: 15.3186877, lng: 119.9852403 },
                { lat: 15.3186282, lng: 119.9853248 },
                { lat: 15.3192594, lng: 119.9857955 },
                { lat: 15.3193099, lng: 119.9857204 },
                { lat: 15.3190499, lng: 119.9855179 },
                { lat: 15.3193952, lng: 119.9850324 }
            ]]
        }
    };

    // Find nearest gate to user's location
    function findNearestGate(lat, lng) {
        const gates = CAMPUS_GATES[state.campus] || [];
        let nearestGate = null;
        let minDist = Infinity;
        
        gates.forEach(gate => {
            const dist = haversine(lat, lng, gate.lat, gate.lng);
            if (dist < minDist) {
                minDist = dist;
                nearestGate = gate;
            }
        });
        
        return nearestGate;
    }

    // Show notification about outside campus
    function showOutsideCampusNotice(gateName) {
        showNotification(`📍 You are outside campus. Proceed to ${gateName} to enter.`, 'info', 5000);
    }

    // ============================================
    // Google Maps Initialization
    // ============================================

    function initGoogleMaps() {
        console.log('[MAP] initGoogleMaps() called - setting up Google Maps API');
        
        window.google = window.google || {};
        window.google.maps = window.google.maps || {};
        
        try {
            state.directionsService = new window.google.maps.DirectionsService();
            state.directionsRenderer = new window.google.maps.DirectionsRenderer({
                polylineOptions: { strokeColor: "#FFB800", strokeWeight: 6 }
            });
            console.log('[MAP] Google Maps services initialized successfully');
        } catch (e) {
            console.error('[MAP] Error initializing Google Maps services:', e.message);
        }
    }

    function initMap() {
        try {
            console.log('[MAP] ============ MAP INITIALIZATION START ============');
            console.log('[MAP] Campus:', state.campus);
            console.log('[MAP] Device:', navigator.userAgent);
            
            // Verify Google Maps is loaded
            if (!window.google || !window.google.maps) {
                console.error('[MAP] Google Maps API not loaded yet');
                console.log('[MAP] Retrying in 1 second...');
                setTimeout(initMap, 1000);
                return;
            }
            
            console.log('[MAP] ✓ Google Maps API detected');
            
            // Ensure directions service is initialized (in case callback didn't run)
            if (!state.directionsService || !state.directionsRenderer) {
                console.log('[MAP] Initializing directions service...');
                initGoogleMaps();
            }
            
            // Verify directions renderer was initialized
            if (!state.directionsRenderer) {
                console.error('[MAP] Failed to initialize directions renderer');
                throw new Error('Directions renderer not initialized');
            }
            
            // Verify DOM element exists
            const mapContainer = document.getElementById('solo-map');
            if (!mapContainer) {
                console.error('[MAP] Map container element not found');
                throw new Error('Map container not found');
            }
            
            console.log('[MAP] Map container found, dimensions:', mapContainer.offsetWidth + 'x' + mapContainer.offsetHeight);
            
            // Check if container has proper size (iOS sometimes needs delay)
            if (mapContainer.offsetWidth === 0 || mapContainer.offsetHeight === 0) {
                console.warn('[MAP] Container has zero size, retrying in 100ms...');
                setTimeout(initMap, 100);
                return;
            }
            
            // Verify config exists
            const config = CAMPUS_CONFIG[state.campus];
            if (!config) {
                console.error('[MAP] Campus config not found for:', state.campus);
                throw new Error('Campus config not found');
            }
            
            // Expose a global function for info window button
            window.__startNavFromInfoWindow = (name) => {
                const found = state.markers.find(m => m.location.name === name);
                if (found) {
                    found.infoWindow.close();
                    startNavigation(found.location);
                }
            };
        
        // Clear previous markers
        if (state.markers && state.markers.length > 0) {
            state.markers.forEach(obj => {
                try {
                    if (obj && obj.marker && typeof obj.marker.setMap === 'function') {
                        obj.marker.setMap(null);
                    }
                } catch (e) {
                    console.warn('[MAP] Error clearing marker:', e);
                }
            });
            state.markers = [];
        }
        
        // Initialize map with error handling
        const mapOptions = {
            center: config.center,
            zoom: 18,
            minZoom: 16,
            maxZoom: 21,
            restriction: (state.campus === 'main' || state.campus === 'botolan') ? {
            latLngBounds: config.bounds,
            strictBounds: true
        } :undefined,
            disableDefaultUI: true,
            zoomControl: false,
            backgroundColor: '#f8fafc',
            mapTypeId: 'satellite',
            mapId: 'bc921b2513c4ace175ad7c43',
            tilt: 0,
            heading: 0,
            gestureHandling: 'greedy'
        };
        
        try {
            console.log('[MAP] Creating map with mapId...');
            state.map = new window.google.maps.Map(document.getElementById('solo-map'), mapOptions);
            console.log('[MAP] ✓ Map instance created with mapId');
        } catch (mapError) {
            console.warn('[MAP] Map creation failed with mapId, trying without mapId:', mapError.message);
            // Fallback: try without mapId (for iOS compatibility)
            delete mapOptions.mapId;
            try {
                state.map = new window.google.maps.Map(document.getElementById('solo-map'), mapOptions);
                console.log('[MAP] ✓ Map instance created without mapId (fallback)');
            } catch (fallbackError) {
                console.error('[MAP] Map creation failed even without mapId:', fallbackError.message);
                throw fallbackError;
            }
        }
        
        console.log('[MAP] ✓ Map initialized successfully');
        
        // Apply campus mask and boundary for all campuses with crop coordinates
        if (config.cropCoords) {
            // Apply inverted mask to restrict navigation outside campus boundary
            applyInvertedMask(config.cropCoords);
            
            // Draw red outline to indicate campus boundary restriction
            new window.google.maps.Polygon({
                paths: config.cropCoords,
                strokeColor: '#ff0000',
                strokeOpacity: 0.9,
                strokeWeight: 3,
                fillOpacity: 0,
                map: state.map
            });
        }
        
        // Set directions renderer map (safe check)
        if (state.directionsRenderer) {
            state.directionsRenderer.setMap(state.map);
            console.log('[MAP] Directions renderer added to map');
        } else {
            console.warn('[MAP] Directions renderer is null, skipping');
        }
        
        // Build unified route graph from all segments
        const routeData = buildRouteGraph(ADDITIONAL_ROUTES);
        state.routeGraph = routeData.graph;
        state.campusRouteCoords = routeData.allCoords;
        state.coordToIndex = routeData.coordToIndex;
        
        // Draw all route segments (transparent white color)
        state.walkableRoutePolylines = [];
        ADDITIONAL_ROUTES.forEach((routeSegment) => {
            const walkablePolyline = new window.google.maps.Polyline({
                path: routeSegment,
                geodesic: true,
                strokeColor: '#FFFFFF',  // White color
                strokeOpacity: 0.5,
                strokeWeight: 5,
                map: state.map
            });
            state.walkableRoutePolylines.push(walkablePolyline);
        });
        
        // Add location markers - use default Google Maps pin marker
        config.locations.forEach(location => {
            const marker = new window.google.maps.Marker({
                position: { lat: location.lat, lng: location.lng },
                map: state.map,
                title: location.name,
                zIndex: 100,
                animation: window.google.maps.Animation.DROP
            });
            
            // Create label overlay
            const labelDiv = document.createElement('div');
            labelDiv.className = 'marker-label';
            labelDiv.textContent = location.name;
            labelDiv.dataset.locationName = location.name;
            
            class LabelOverlay extends window.google.maps.OverlayView {
                constructor(position, labelDiv, map) {
                    super();
                    this.position = position;
                    this.labelDiv = labelDiv;
                    this.setMap(map);
                }
                
                onAdd() {
                    this.getPanes().overlayImage.appendChild(this.labelDiv);
                }
                
                draw() {
                    const projection = this.getProjection();
                    if (!projection) return;
                    const pos = projection.fromLatLngToDivPixel(new window.google.maps.LatLng(this.position.lat, this.position.lng));
                    if (pos) {
                        this.labelDiv.style.left = pos.x + 'px';
                        this.labelDiv.style.top = pos.y + 'px';
                    }
                }
                
                onRemove() {
                    if (this.labelDiv.parentNode) {
                        this.labelDiv.parentNode.removeChild(this.labelDiv);
                    }
                }
            }
            
            new LabelOverlay({ lat: location.lat, lng: location.lng }, labelDiv, state.map);
            
            // Info window with image support
            const infoWindow = new window.google.maps.InfoWindow({
                content: `
                    <div style="max-width: 250px; padding: 8px;">
                        <h3 style="margin: 0 0 10px 0; color: #1a3a8a; font-size: 1.1em; font-weight: 700;">${location.name}</h3>
                        <p style="margin: 0 0 10px 0; color: #475569; line-height: 1.5;">${location.description}</p>
                        ${location.image ? `<img src="${location.image}" style="width: 100%; height: auto; border-radius: 8px; margin-top: 8px;" alt="${location.name}" />` : ''}
                    </div>
                `
            });
            
            marker.addListener('click', () => {
                // Close other info windows
                state.markers.forEach(m => m.infoWindow && m.infoWindow.close());

                // Show building overview in sidebar (don't start navigation yet)
                showBuildingPreview(location);
            });
            
            state.markers.push({ marker, location, infoWindow });
        });
        
        // Update status
        updateStatus('gps-status', 'active');
        console.log('[MAP] Map initialization completed successfully');
        
        } catch (error) {
            console.error('[MAP] Fatal error in initMap():', error);
            console.error('[MAP] Stack:', error.stack);
            showNotification('Error initializing map: ' + error.message, 'error');
        }
    }

    function applyInvertedMask(coords) {
        const bounds = CAMPUS_CONFIG[state.campus].bounds;
        const outerBounds = [
            { lat: bounds.north, lng: bounds.west },
            { lat: bounds.north, lng: bounds.east },
            { lat: bounds.south, lng: bounds.east },
            { lat: bounds.south, lng: bounds.west },
            { lat: bounds.north, lng: bounds.west }
        ];
        
        new window.google.maps.Polygon({
            paths: [outerBounds, coords.map(c => ({ lat: c.lat, lng: c.lng }))],
            strokeWeight: 0,
            fillColor: "#000000",
            fillOpacity: 0.4,
            map: state.map,
            zIndex: 1,
            clickable: false
        });
    }

    // ============================================
    // Location Tracking
    // ============================================

    // Create and update pulsing circle around user location
    function updatePulsingCircle(position) {
        if (!state.map) return;
        
        // Clear old circles
        state.pulsingCircles.forEach(circle => circle.setMap(null));
        state.pulsingCircles = [];
        
        // Create main pulsing circle (innermost)
        const pulseCircle1 = new google.maps.Circle({
            center: position,
            radius: 8,  // 8 meters
            map: state.map,
            fillColor: '#3B82F6',
            fillOpacity: 0.4,
            strokeColor: '#3B82F6',
            strokeWeight: 1,
            strokeOpacity: 0.6,
            zIndex: 999
        });
        
        // Create secondary pulsing circle (outer)
        const pulseCircle2 = new google.maps.Circle({
            center: position,
            radius: 15,  // 15 meters
            map: state.map,
            fillColor: '#3B82F6',
            fillOpacity: 0.2,
            strokeColor: '#3B82F6',
            strokeWeight: 1,
            strokeOpacity: 0.3,
            zIndex: 998
        });
        
        // Create third pulsing circle (outermost)
        const pulseCircle3 = new google.maps.Circle({
            center: position,
            radius: 25,  // 25 meters
            map: state.map,
            fillColor: '#3B82F6',
            fillOpacity: 0.1,
            strokeColor: '#3B82F6',
            strokeWeight: 0.5,
            strokeOpacity: 0.2,
            zIndex: 997
        });
        
        state.pulsingCircles = [pulseCircle1, pulseCircle2, pulseCircle3];
        
        // Animate pulse effect
        animatePulseCircles();
    }

    // Animate the pulsing circles with expanding ripple effect
    function animatePulseCircles() {
        let pulsePhase = 0;
        
        const pulseInterval = setInterval(() => {
            if (state.pulsingCircles.length === 0) {
                clearInterval(pulseInterval);
                return;
            }
            
            pulsePhase = (pulsePhase + 1) % 100;
            const factor = pulsePhase / 100;  // 0 to 1
            
            // Ripple effect: circles expand and fade
            if (state.pulsingCircles[0]) {
                state.pulsingCircles[0].setRadius(8 + factor * 12);
                state.pulsingCircles[0].setOptions({
                    fillOpacity: 0.4 * (1 - factor),
                    strokeOpacity: 0.6 * (1 - factor)
                });
            }
            
            if (state.pulsingCircles[1]) {
                state.pulsingCircles[1].setRadius(15 + factor * 15);
                state.pulsingCircles[1].setOptions({
                    fillOpacity: 0.2 * (1 - factor),
                    strokeOpacity: 0.3 * (1 - factor)
                });
            }
            
            if (state.pulsingCircles[2]) {
                state.pulsingCircles[2].setRadius(25 + factor * 20);
                state.pulsingCircles[2].setOptions({
                    fillOpacity: 0.1 * (1 - factor),
                    strokeOpacity: 0.2 * (1 - factor)
                });
            }
        }, 50);  // Update every 50ms for smooth animation
    }

    function clearPulsingCircles() {
        if (state.pulsingCircles && state.pulsingCircles.length > 0) {
            state.pulsingCircles.forEach(circle => {
                try {
                    circle.setMap(null);
                } catch (e) {
                }
            });
        }
        state.pulsingCircles = [];
    }

    function startTracking() {
        if (!navigator.geolocation) {
            showNotification('Geolocation is not supported by this browser.', 'error');
            updateStatus('gps-status', 'error');
            return;
        }

        if (!state.locationPermissionConfirmed && typeof showLocationPermissionPanel === 'function') {
            showLocationPermissionPanel()
                .then(() => {
                    state.locationPermissionConfirmed = true;
                    startTracking();
                })
                .catch(() => {
                    showNotification('Location permission denied.', 'warning', 5000);
                    updateStatus('gps-status', 'error');
                });
            return;
        }
        
        if (state.watchId !== null) return;
        
        const SMOOTHING_WINDOW = 5;
        let positionBuffer = [];
        let lastSmoothed = null;
        
        state.watchId = navigator.geolocation.watchPosition(
            (position) => {
                const userPos = {
                    lat: position.coords.latitude,
                    lng: position.coords.longitude
                };
                
                // Smooth position
                positionBuffer.push(userPos);
                if (positionBuffer.length > SMOOTHING_WINDOW) positionBuffer.shift();
                
                const avg = positionBuffer.reduce((acc, p) => ({ lat: acc.lat + p.lat, lng: acc.lng + p.lng }), { lat: 0, lng: 0 });
                avg.lat /= positionBuffer.length;
                avg.lng /= positionBuffer.length;
                
                // Update only if moved significantly
                let shouldUpdate = true;
                if (lastSmoothed) {
                    const dist = haversine(avg.lat, avg.lng, lastSmoothed.lat, lastSmoothed.lng);
                    shouldUpdate = dist > 2;
                }
                
                if (shouldUpdate) {
                    lastSmoothed = { lat: avg.lat, lng: avg.lng };
                    state.userLocation = avg;
                    
                    // ===== FEED GPS DATA INTO SENSOR FUSION =====
                    handleSensorFusion(
                        avg,  // GPS position
                        position.coords.altitude,
                        position.coords.accuracy,
                        sensorFusion.compassHeading,  // Current compass heading
                        state.deviceOrientation?.alpha || 0,
                        state.deviceOrientation?.beta || 0,
                        state.deviceOrientation?.gamma || 0
                    );
                    
                    // Update user marker with fused heading
                    // Always use green arrow (synced with corrected heading from sensor fusion)
                    const userIcon = {
                        path: window.google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
                        scale: 4,
                        fillColor: '#00FF00',
                        fillOpacity: 1,
                        strokeColor: '#ffffff',
                        strokeWeight: 3,
                        rotation: sensorFusion.arrowHeading || 0  // Use corrected heading (map bearing subtracted)
                    };

                    if (!state.userMarker) {
                        state.userMarker = new window.google.maps.Marker({
                            position: avg,
                            map: state.map,
                            title: 'Your Location',
                            icon: userIcon,
                            zIndex: 1000,
                            optimized: true
                        });
                    } else {
                        animateUserMarkerTo(avg);

                        const now = Date.now();
                        const rot = userIcon.rotation || 0;
                        const lastRot = state.lastUserIconRotation;
                        const shouldUpdateIcon = (lastRot === null || Math.abs(rot - lastRot) >= 2) && (now - state.lastUserIconUpdateAt >= 120);

                        if (shouldUpdateIcon) {
                            state.userMarker.setIcon(userIcon);
                            state.lastUserIconUpdateAt = now;
                            state.lastUserIconRotation = rot;
                        }
                    }

                    // Remove any blinking/pulsing effects around the user
                    clearPulsingCircles();
                    
                    // Update navigation if active
                    if (state.currentDestination) {
                        updateNavigation();
                        
                        // Maintain 3D camera during navigation
                        if (state.is3DNavigationMode && state.map) {
                            try {
                                state.map.setTilt(67.5);
                                state.map.setZoom(21);
                            } catch (e) {
                                console.warn('[GPS] Could not maintain 3D camera:', e);
                            }
                        }
                        
                        // Broadcast user location to multiplayer
                        broadcastUserLocation();
                    }
                    
                    updateStatus('gps-status', 'active');
                }
            },
            (error) => {
                console.error('Geolocation error:', error);
                updateStatus('gps-status', 'error');
                
                // Use campus center as fallback when geolocation fails
                state.userLocation = CAMPUS_CONFIG[state.campus].center;
            },
            {
                enableHighAccuracy: true,
                timeout: 20000,
                maximumAge: 0
            }
        );
    }

    // ============================================
    // Navigation System
    // ============================================

    function stopNavigation() {
        // Clear notification flag
        state.arrivalNotificationShown = false;
        state.currentDestination = null;
        state.currentPath = [];
        
        // Clear route polylines
        if (state.currentRoutePolyline) {
            state.currentRoutePolyline.setMap(null);
            state.currentRoutePolyline = null;
        }
        if (state.userToRouteConnector) {
            state.userToRouteConnector.setMap(null);
            state.userToRouteConnector = null;
        }
        if (state.outsideRoutePolyline) {
            state.outsideRoutePolyline.setMap(null);
            state.outsideRoutePolyline = null;
        }
        
        // Clear navigation instructions
        document.getElementById('instruction-main').textContent = 'Select a destination to begin';
        document.getElementById('instruction-distance').textContent = '';
        
        // Stop route arrow animation if active
        stopRouteArrowAnimation();
        stopConnectorLineAnimation();
        
        console.log('[NAVIGATION] Navigation stopped');
    }

    function showBuildingPreview(location) {
        state.pendingDestination = location;

        // Hide navigation panel (if previously shown)
        const navInfo = document.getElementById('navigation-info');
        if (navInfo) navInfo.classList.remove('active');

        // Populate overview panel
        const panel       = document.getElementById('building-overview');
        const imgEl       = document.getElementById('overview-img');
        const placeholder = document.getElementById('overview-img-placeholder');
        const nameEl      = document.getElementById('overview-name');
        const metaEl      = document.getElementById('overview-meta');
        const descEl      = document.getElementById('overview-desc');

        if (!panel) return;

        nameEl.textContent = location.name;
        descEl.textContent = location.description || 'No description available.';

        if (location.image) {
            imgEl.src = location.image;
            imgEl.style.display = 'block';
            if (placeholder) placeholder.style.display = 'none';
        } else {
            imgEl.style.display = 'none';
            if (placeholder) placeholder.style.display = 'flex';
        }

        // Estimate walk time if user location is known
        if (state.userLocation) {
            const dist = haversine(
                state.userLocation.lat, state.userLocation.lng,
                location.lat, location.lng
            );
            const mins = Math.ceil(dist / 80); // ~80m per minute walking
            metaEl.textContent = `~${formatDistance(dist)} • ~${mins} min walk`;
        } else {
            metaEl.textContent = 'Tap START to begin navigation';
        }

        panel.style.display = 'block';

        // Open sidebar on mobile when marker is selected
        const sidebar = document.getElementById('sidebar');
        const isMobile = window.innerWidth <= 900;
        
        if (sidebar) {
            if (isMobile) {
                // On mobile, ensure sidebar is open
                if (!sidebar.classList.contains('open')) {
                    sidebar.classList.add('open');
                }
            } else {
                // On desktop, toggle if collapsed
                if (sidebar.classList.contains('collapsed')) {
                    toggleSidebar();
                }
            }
        }
        
        // Display heatmap for this building
        showHeatmap(location.name);
    }

    function hideBuildingPreview() {
        const panel = document.getElementById('building-overview');
        if (panel) {
            panel.style.display = 'none';
        }
        state.pendingDestination = null;
        hideHeatmap();
    }

    function showHeatmap(buildingName) {
        // Only show heatmap for main campus
        if (state.campus !== 'main' || !state.map) return;
        
        // Clear previous heatmap
        hideHeatmap();
        
        // Find heatmap data for this building
        const heatmapData = BUILDING_HEATMAPS[buildingName];
        if (!heatmapData) {
            console.log('[HEATMAP] No heatmap data found for:', buildingName);
            return;
        }
        
        // Create polygons for each part of the building
        heatmapData.parts.forEach((polygonPath, index) => {
            const polygon = new window.google.maps.Polygon({
                paths: polygonPath,
                strokeColor: '#FFB800',
                strokeOpacity: 0.8,
                strokeWeight: 2,
                fillColor: '#FFB800',
                fillOpacity: 0.25,
                map: state.map,
                zIndex: 50
            });
            
            state.currentHeatmapPolygons.push(polygon);
        });
        
        console.log('[HEATMAP] Displayed', state.currentHeatmapPolygons.length, 'polygons for:', buildingName);
    }

    function hideHeatmap() {
        // Remove all current heatmap polygons
        state.currentHeatmapPolygons.forEach(polygon => {
            polygon.setMap(null);
        });
        state.currentHeatmapPolygons = [];
        console.log('[HEATMAP] Heatmap cleared');
    }

    function startNavigation(target) {
        const options = arguments.length > 1 && arguments[1] ? arguments[1] : {};
        if (!state.map || !state.routeGraph) {
            showNotification('Map or route data not ready', 'error');
            return;
        }
        
        // Use campus center if no user location
        if (!state.userLocation) {
            state.userLocation = CAMPUS_CONFIG[state.campus].center;
        }
        
        state.currentDestination = target;

        hideAllMarkers();
        hideMarkerLabels();
        closeAllInfoWindows();

        // If route arrows are animating, stop before replacing route polyline
        stopRouteArrowAnimation();
        
        // Clear previous route
        if (state.currentRoutePolyline) {
            state.currentRoutePolyline.setMap(null);
        }
        if (state.userToRouteConnector) {
            state.userToRouteConnector.setMap(null);
            state.userToRouteConnector = null;
        }
        if (state.outsideRoutePolyline) {
            state.outsideRoutePolyline.setMap(null);
        }
        
        let startLat = state.userLocation.lat;
        let startLng = state.userLocation.lng;
        let userOutsideCampus = !isInsideCampus(startLat, startLng);
        let nearestGate = null;

        // Heuristic: if you're near a gate but far from any walkable route point, force gate-entry routing
        // (prevents the route from "cutting" across the campus border near entrances)
        try {
            const gates = CAMPUS_GATES[state.campus] || [];
            let nearestGateDist = Infinity;
            gates.forEach(g => {
                const d = haversine(startLat, startLng, g.lat, g.lng);
                if (d < nearestGateDist) nearestGateDist = d;
            });

            let nearestRouteDist = Infinity;
            if (Array.isArray(state.campusRouteCoords) && state.campusRouteCoords.length > 0) {
                state.campusRouteCoords.forEach(coord => {
                    const d = haversine(startLat, startLng, coord.lat, coord.lng);
                    if (d < nearestRouteDist) nearestRouteDist = d;
                });
            }

            if (!userOutsideCampus && nearestGateDist <= 35 && nearestRouteDist >= 55) {
                console.log('[ROUTING] Gate-entry heuristic triggered:', { nearestGateDist, nearestRouteDist });
                userOutsideCampus = true;
            }
        } catch (e) {
            console.warn('[ROUTING] Gate-entry heuristic error:', e);
        }
        
        // If user is outside campus, route them to nearest gate first
        if (userOutsideCampus) {
            // Clear any connector lines when user is outside campus
            if (state.userToRouteConnector) {
                state.userToRouteConnector.setMap(null);
                state.userToRouteConnector = null;
            }
            nearestGate = findNearestGate(startLat, startLng);
            if (nearestGate) {
                // Start campus route from the gate (no extended line drawn outside)
                startLat = nearestGate.lat;
                startLng = nearestGate.lng;
                // Show notification about outside campus
                if (!options.isReroute) {
                    showOutsideCampusNotice(nearestGate.name);
                }
            }
        }
        
        // Find route on campus walkable paths
        let userNodeIdx, destNodeIdx, pathNodeIndices;
        
        // CLEAR OLD ROUTE FIRST - remove previous polyline to show ONLY ONE route
        if (state.currentRoutePolyline) {
            state.currentRoutePolyline.setMap(null);
            state.currentRoutePolyline = null;
        }
        
        console.log('[ROUTING] Starting navigation to:', target.name);
        console.log('[ROUTING] Campus route coords:', state.campusRouteCoords.length, 'points');
        console.log('[ROUTING] Route graph nodes:', Object.keys(state.routeGraph || {}).length);
        
        // Get candidate nodes (closest and alternatives)
        // IMPORTANT: Only use defined walkable routes - no creating new paths
        let userNodeCandidates, destNodeCandidates;
        
        // User location starting distance thresholds (campus-specific)
        let USER_MAX_DISTANCE = 100; // 100m max distance to route start (flexible for all campuses)

        // Destination snapping:
        // - Larger radius to allow connectors to reach buildings in all sectors
        const destIsInsideCampus = isInsideCampus(target.lat, target.lng);
        const isDormDestination = (target && target.name) ? target.name.toUpperCase().includes('DORM') : false;
        const isBackGateDestination = (target && target.name) ? target.name.toUpperCase().includes('BACK GATE') : false;
        
        // Use flexible snapping for all campuses (Iba-style routing)
        let DEST_MAX_DISTANCE = isDormDestination ? 250 : (destIsInsideCampus ? 200 : 100);
        
        if (userOutsideCampus && nearestGate) {
            userNodeCandidates = findClosestRoutePointRobust(nearestGate.lat, nearestGate.lng, state.campusRouteCoords, USER_MAX_DISTANCE);
            console.log('[ROUTING] User outside - trying gate nodes:', userNodeCandidates);
        } else {
            userNodeCandidates = findClosestRoutePointRobust(startLat, startLng, state.campusRouteCoords, USER_MAX_DISTANCE);
            console.log('[ROUTING] User inside - trying nodes:', userNodeCandidates);
        }
        
        destNodeCandidates = findClosestRoutePointRobust(target.lat, target.lng, state.campusRouteCoords, DEST_MAX_DISTANCE);
        console.log('[ROUTING] Destination candidates (max distance: ' + DEST_MAX_DISTANCE + 'm):', destNodeCandidates);
        
        // Check if destination is reachable (has route connection points)
        if (!destNodeCandidates || destNodeCandidates.length === 0) {
            const destIsOutside = !isInsideCampus(target.lat, target.lng);
            
            if (destIsOutside) {
                // If destination is outside campus, route to the nearest gate instead
                const nearestGateToDest = findNearestGate(target.lat, target.lng);
                if (nearestGateToDest) {
                    console.log('[ROUTING] Destination outside campus, routing to nearest gate:', nearestGateToDest.name);
                    showNotification(`${target.name} is outside campus. Routing to nearest gate: ${nearestGateToDest.name}`, 'info');
                    
                    // Recursively call startNavigation with the gate as destination
                    // Create a modified destination object for the gate
                    const gateDestination = {
                        name: nearestGateToDest.name,
                        lat: nearestGateToDest.lat,
                        lng: nearestGateToDest.lng
                    };
                    
                    // Store the original destination so we can reference it if needed
                    state.originalDestination = target;
                    state.currentDestination = gateDestination;
                    
                    // Restart navigation with the gate
                    return startNavigation(gateDestination);
                }
            } else {
                // Destination is inside campus but not reachable
                // For all campuses: offer alternative routing via gate
                const nearestGateToDest = findNearestGate(target.lat, target.lng);
                if (nearestGateToDest) {
                    console.log('[ROUTING] Destination inside campus but not directly reachable, routing to nearest gate:', nearestGateToDest.name);
                    showNotification(`Can't reach ${target.name} directly. Routing to nearest gate: ${nearestGateToDest.name}`, 'info');
                    
                    const gateDestination = {
                        name: nearestGateToDest.name,
                        lat: nearestGateToDest.lat,
                        lng: nearestGateToDest.lng
                    };
                    
                    state.originalDestination = target;
                    state.currentDestination = gateDestination;
                    return startNavigation(gateDestination);
                } else {
                    // Fallback error message if no gate can be found
                    showNotification(`Cannot reach ${target.name}. No alternative routes available.`, 'error');
                    state.currentPath = [];
                    return;
                }
            }
        }
        
        // Check if user location is reachable
        if (!userNodeCandidates || userNodeCandidates.length === 0) {
            // User is outside the walkable routes - route from nearest gate instead
            const nearestGateToUser = findNearestGate(startLat, startLng);
            if (nearestGateToUser) {
                console.log('[ROUTING] User location not directly on routes, routing from nearest gate:', nearestGateToUser.name);
                showNotification(`Starting from nearby gate: ${nearestGateToUser.name}`, 'info');
                
                // Create a temporary start point at the nearest gate
                const gateStartPoint = {
                    name: nearestGateToUser.name,
                    lat: nearestGateToUser.lat,
                    lng: nearestGateToUser.lng
                };
                
                // Use the gate as the user location for routing
                userNodeCandidates = findClosestRoutePointRobust(gateStartPoint.lat, gateStartPoint.lng, state.campusRouteCoords, USER_MAX_DISTANCE);
                console.log('[ROUTING] Gate routing nodes:', userNodeCandidates);
                
                // If gate is also not on route, show error
                if (!userNodeCandidates || userNodeCandidates.length === 0) {
                    showNotification('Cannot reach nearby gates. Please move closer to campus.', 'error');
                    state.currentPath = [];
                    return;
                }
            } else {
                console.error('[ROUTING] User location not reachable and no gates found');
                showNotification('Your location is not reachable. Please move closer to campus.', 'error');
                state.currentPath = [];
                return;
            }
        }
  
        // Try ALL candidate combinations and choose the SHORTEST total path
        pathNodeIndices = null;
        userNodeIdx = null;
        destNodeIdx = null;
        
        // SIMPLIFY: Use ONLY the closest candidates, not all combinations
        // This ensures we take the most direct route, not the "long way around"
        userNodeIdx = userNodeCandidates[0]; // Closest user location to any route node
        destNodeIdx = destNodeCandidates[0]; // Closest destination to any route node
        
        console.log('[ROUTING] Using closest candidates: User node', userNodeIdx, '@ route point', state.campusRouteCoords[userNodeIdx]);
        console.log('[ROUTING] Using closest candidates: Dest node', destNodeIdx, '@ route point', state.campusRouteCoords[destNodeIdx]);
        
        // Run Dijkstra with the closest candidates
        const testPath = dijkstra(state.routeGraph, userNodeIdx, destNodeIdx);
        
        if (testPath && testPath.length > 0) {
            pathNodeIndices = testPath;
            
            // Calculate distances for logging
            const userToRoute = haversine(
                startLat, startLng,
                state.campusRouteCoords[userNodeIdx].lat,
                state.campusRouteCoords[userNodeIdx].lng
            );
            
            let routeDistance = 0;
            for (let i = 0; i < testPath.length - 1; i++) {
                routeDistance += haversine(
                    state.campusRouteCoords[testPath[i]].lat,
                    state.campusRouteCoords[testPath[i]].lng,
                    state.campusRouteCoords[testPath[i + 1]].lat,
                    state.campusRouteCoords[testPath[i + 1]].lng
                );
            }
            
            const routeToDestination = haversine(
                state.campusRouteCoords[destNodeIdx].lat,
                state.campusRouteCoords[destNodeIdx].lng,
                target.lat, target.lng
            );
            
            const totalDistance = userToRoute + routeDistance + routeToDestination;
            console.log('[ROUTING] Route distance breakdown:', {
                userToRoute: userToRoute.toFixed(2) + 'm',
                routeDistance: routeDistance.toFixed(2) + 'm',
                routeToDestination: routeToDestination.toFixed(2) + 'm',
                total: totalDistance.toFixed(2) + 'm'
            });
            console.log('[ROUTING] Path uses', testPath.length, 'connector nodes between closest pairs');
        }
        
        console.log('[ROUTING] Dijkstra result:', pathNodeIndices && pathNodeIndices.length > 0 ? 'Found path with ' + pathNodeIndices.length + ' nodes' : 'NO PATH FOUND');
        
        // If pathfinding fails, show error
        if (!pathNodeIndices || pathNodeIndices.length === 0) {
            console.error('[ROUTING] Route generation failed - no walkable path found');
            console.log('[ROUTING] Could not connect:', {
                start: userNodeCandidates[0],
                dest: destNodeCandidates[0],
                startAlternatives: userNodeCandidates,
                destAlternatives: destNodeCandidates
            });
            showNotification('No walkable route found to this destination. Please try another location.', 'error');
            state.currentPath = [];
            return;
        }
        
        // Simplify path to ensure SINGLE route without loops or branches
        console.log('[ROUTING] Path before simplification:', pathNodeIndices.slice(0, 5).map(idx => `idx:${idx}`).join(' -> '), 
                    '...', pathNodeIndices.slice(-3).map(idx => `idx:${idx}`).join(' -> '));
        pathNodeIndices = simplifyPath(pathNodeIndices, state.campusRouteCoords);
        console.log('[ROUTING] Simplified path has', pathNodeIndices.length, 'nodes (indices:', pathNodeIndices.slice(0, 5).join(','), '...', pathNodeIndices.slice(-3).join(','), ')');
        
        // Build complete path: ONLY use defined walkable routes
        // Connect user location and destination ONLY if they're close to route points
        state.currentPath = [];
        
        // Get the route coordinates (these are the ONLY walkable paths)
        const routeCoords = pathNodeIndices.map(idx => state.campusRouteCoords[idx]);
        console.log('[ROUTING] Route coordinates extracted:', routeCoords.length, 'points');
        if (routeCoords.length > 0) {
            console.log('[ROUTING] Route starts at:', routeCoords[0].lat.toFixed(5), routeCoords[0].lng.toFixed(5));
            console.log('[ROUTING] Route ends at:', routeCoords[routeCoords.length-1].lat.toFixed(5), routeCoords[routeCoords.length-1].lng.toFixed(5));
        }
        
        // Start with user location (or gate if outside) - but only if it's not already on the route
        const startRoutePoint = routeCoords[0];
        const userToRouteStartDist = haversine(
            startLat, startLng,
            startRoutePoint.lat, startRoutePoint.lng
        );
        
        // For outside campus users: route starts directly from the gate (no extended line drawn)
        // For inside campus users: route starts directly from walkable paths
        // No extended lines added to the path
        
        // Add the route path (ONLY defined walkable routes through connectors)
        routeCoords.forEach(coord => {
            state.currentPath.push(coord);
        });
        
        // Add final destination segment to ensure route reaches the actual building/location
        // This connects the last route point (connector endpoint) to the actual destination
        const endRoutePoint = routeCoords[routeCoords.length - 1];
        const routeEndToDestDist = haversine(
            endRoutePoint.lat, endRoutePoint.lng,
            target.lat, target.lng
        );
        // Always add the final destination to complete the route
        if (routeEndToDestDist > 0.1) {
            state.currentPath.push({ lat: target.lat, lng: target.lng });
            console.log('[ROUTING] Added final destination segment:', routeEndToDestDist.toFixed(2), 'm from last route point');
        }
        
        state.currentStepIndex = 0;
        
        // Remove duplicate consecutive coordinates and detect U-turns
        const cleanPath = [];
        for (let i = 0; i < state.currentPath.length; i++) {
            // Skip exact duplicates
            if (i > 0 && 
                state.currentPath[i].lat === state.currentPath[i - 1].lat && 
                state.currentPath[i].lng === state.currentPath[i - 1].lng) {
                continue;
            }
            
            // Check for U-turns: if we go back to a coordinate we visited 2 steps ago, remove the U-turn
            if (i >= 2) {
                const prev = state.currentPath[i - 1];
                const prevPrev = state.currentPath[i - 2];
                const current = state.currentPath[i];
                
                // If current is very close to prevPrev (within 3 meters), it's a U-turn
                const distToPrevPrev = haversine(current.lat, current.lng, prevPrev.lat, prevPrev.lng);
                if (distToPrevPrev < 3) {
                    console.log(`[ROUTING] Detected U-turn at index ${i}, removing intermediate point`);
                    // Remove the previous point (the one that created the U-turn)
                    cleanPath.pop();
                    continue;
                }
            }
            
            cleanPath.push(state.currentPath[i]);
        }
        state.currentPath = cleanPath;
        console.log('[ROUTING] Cleaned path has', state.currentPath.length, 'unique coordinates (removed', 
                    (state.currentPath.length - cleanPath.length), 'duplicates/U-turns)');
        
        // Log first 3 and last 3 points of cleaned path
        if (state.currentPath.length > 0) {
            console.log('[ROUTING] Path START:', state.currentPath.slice(0, 3).map(p => `(${p.lat.toFixed(5)},${p.lng.toFixed(5)})`).join(' -> '));
            if (state.currentPath.length > 6) {
                console.log('[ROUTING] Path END:', state.currentPath.slice(-3).map(p => `(${p.lat.toFixed(5)},${p.lng.toFixed(5)})`).join(' -> '));
            }
        }
        
        // Calculate total distance
        let totalDistance = 0;
        for (let i = 0; i < state.currentPath.length - 1; i++) {
            totalDistance += haversine(
                state.currentPath[i].lat, state.currentPath[i].lng,
                state.currentPath[i + 1].lat, state.currentPath[i + 1].lng
            );
        }
        console.log('[ROUTING] Total route distance: ' + totalDistance.toFixed(2) + ' meters');
        
        // ENSURE ONLY ONE POLYLINE: Clear any existing route polyline first
        if (state.currentRoutePolyline) {
            state.currentRoutePolyline.setMap(null);
            state.currentRoutePolyline = null;
        }
        
        // Draw route following shortest path (green for navigation) - SINGLE ROUTE ONLY
        state.currentRoutePolyline = new window.google.maps.Polyline({
                path: state.currentPath,
                geodesic: true,
                strokeColor: '#ADFF2F',
                strokeOpacity: 0.9,
                strokeWeight: 7,
                zIndex: 100,
                map: state.map 
            });
        
        console.log('[ROUTING] Polyline drawn with', state.currentPath.length, 'points to destination:', target.name);

        // Draw connection line from user to route if user is not on the walkable path
        // This shows users how to reach the closest walkable route from their current location
        if (!userOutsideCampus && state.currentPath.length > 0) {
            // User is inside campus: check if they're already on the first route point
            const firstRoutePath = state.currentPath[0];
            const distUserToRoute = haversine(
                state.userLocation.lat, state.userLocation.lng,
                firstRoutePath.lat, firstRoutePath.lng
            );
            
            // If user is more than 5 meters away from the first route point, draw connector
            if (distUserToRoute > 5) {
                // Clear any existing connector line
                if (state.userToRouteConnector) {
                    state.userToRouteConnector.setMap(null);
                    state.userToRouteConnector = null;
                }
                
                // Draw dashed line from user to nearest route point
                state.userToRouteConnector = new window.google.maps.Polyline({
                    path: [
                        { lat: state.userLocation.lat, lng: state.userLocation.lng },
                        { lat: firstRoutePath.lat, lng: firstRoutePath.lng }
                    ],
                    geodesic: true,
                    strokeColor: '#FF9800',  // Orange for connector
                    strokeOpacity: 0.7,
                    strokeWeight: 4,
                    strokeDasharray: [5, 5],  // Dashed pattern
                    zIndex: 99,
                    map: state.map
                });
                
                // Animate the connector line with arrows
                startConnectorLineAnimation();
                
                console.log('[ROUTING] Connection line added: User is', distUserToRoute.toFixed(2), 'm away from walkable route entry');
            }
        }

        // If 3D mode is active, keep clutter hidden and keep route arrows animating on the regenerated route
        if (state.is3DNavigationMode) {
            hideAllMarkers();
            hideMarkerLabels();
            closeAllInfoWindows();
            hideSearchResults();
            styleWalkableRoutesFor3D();
            startRouteArrowAnimation();
            // Also animate connector line if it exists
            if (state.userToRouteConnector) {
                startConnectorLineAnimation();
            }
        }
        
        // Generate turn-by-turn directions
        const steps = generateTurnByTurnSteps(state.currentPath);
        
        if (steps.length === 0) {
            console.error('[NAVIGATION] No steps generated');
            showNotification('Unable to generate navigation steps. Please try again.', 'error');
            return;
        }
        
        // Update UI
        document.getElementById('dest-name').textContent = target.name;
        document.getElementById('route-stats').textContent = `${formatDistance(totalDistance)} • ~${Math.ceil(totalDistance / 80)} min walk`;

        state.navigationSteps = steps;
        state.currentStepInstructions = steps[0];
        state.completedSteps = new Set();

        renderSteps(state.navigationSteps);
        updateCurrentInstruction(state.navigationSteps[0]);
        
        // Show navigation panel
        document.getElementById('navigation-info').classList.add('active');
        // nav-arrow overlay removed; only user marker shows direction
        
        updateStatus('nav-status', 'active');
        document.querySelector('#nav-status span').textContent = 'Navigating';
    }

    function generateTurnByTurnSteps(path) {
        const steps = [];
        
        for (let i = 0; i < path.length - 1; i++) {
            const current = path[i];
            const next = path[i + 1];
            const bearing = calculateBearing(current.lat, current.lng, next.lat, next.lng);
            const distance = haversine(current.lat, current.lng, next.lat, next.lng);
            
            let instruction = { type: 'straight', text: 'Continue straight', icon: 'up' };
            
            if (i < path.length - 2) {
                const afterNext = path[i + 2];
                const nextBearing = calculateBearing(next.lat, next.lng, afterNext.lat, afterNext.lng);
                instruction = getTurnDirection(bearing, nextBearing);
            } else {
                instruction = { type: 'destination', text: 'Arrive at destination', icon: 'flag' };
            }
            
            steps.push({
                index: i,
                instruction: instruction,
                distance: distance,
                position: current,
                bearing: bearing
            });
        }
        
        return steps;
    }

    function renderSteps(steps) {
        const container = document.getElementById('step-by-step');
        if (!container) {
            console.warn('[STEPS] step-by-step container not found');
            return;
        }
        
        container.innerHTML = '';
        
        const stepsCountEl = document.getElementById('steps-count');
        if (stepsCountEl) {
            stepsCountEl.textContent = `${steps.length} steps`;
        }
        
        steps.forEach((step, idx) => {
            const stepEl = document.createElement('div');
            stepEl.className = `step-item ${idx === 0 ? 'active' : ''}`;
            stepEl.innerHTML = `
                <div class="step-icon">
                    ${getDirectionIcon(step.instruction.icon)}
                </div>
                <div class="step-text">${step.instruction.text}</div>
                <div class="step-distance">${formatDistance(step.distance)}</div>
            `;
            stepEl.onclick = () => focusOnStep(step, idx);
            container.appendChild(stepEl);
        });
    }

    function getDirectionIcon(type) {
        const icons = {
            'up': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
            'right': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>',
            'left': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>',
            'right-up': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 17L17 7M17 7H7M17 7v10"/></svg>',
            'left-up': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 17L7 7M7 17h10M7 17V7"/></svg>',
            'right-down': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 7l10 10M17 17H7M17 17V7"/></svg>',
            'left-down': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 7L7 17M7 17h10M7 17V7"/></svg>',
            'flag': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>'
        };
        return icons[type] || icons['up'];
    }

    function updateCurrentInstruction(step) {
        const mainEl = document.getElementById('instruction-main');
        const distanceEl = document.getElementById('instruction-distance');
        const iconEl = document.getElementById('instruction-icon');
        
        if (mainEl && step && step.instruction) {
            mainEl.textContent = step.instruction.text;
        }
        if (distanceEl && step) {
            distanceEl.textContent = `in ${formatDistance(step.distance)}`;
        }
        if (iconEl && step && step.instruction) {
            iconEl.innerHTML = getDirectionIcon(step.instruction.icon);
        }
    }

    function focusOnStep(step, idx) {
        state.map.panTo(new window.google.maps.LatLng(step.position.lat, step.position.lng));
        
        // Update active step
        document.querySelectorAll('.step-item').forEach((el, i) => {
            el.classList.toggle('active', i === idx);
        });
    }

    function updateNavigation() {
        if (!state.currentPath || state.currentPath.length === 0) return;
        if (!state.userLocation) return;

        // Live rerouting while user moves (throttled)
        if (state.currentDestination && state.userLocation) {
            const now = Date.now();
            const lastLoc = state.lastRerouteLocation;
            const movedSinceLast = lastLoc ? haversine(state.userLocation.lat, state.userLocation.lng, lastLoc.lat, lastLoc.lng) : Infinity;
            const REROUTE_MIN_INTERVAL_MS = 3000;
            const REROUTE_MIN_MOVE_M = 6;

            if ((now - (state.lastRerouteAt || 0)) >= REROUTE_MIN_INTERVAL_MS && movedSinceLast >= REROUTE_MIN_MOVE_M) {
                state.lastRerouteAt = now;
                state.lastRerouteLocation = { lat: state.userLocation.lat, lng: state.userLocation.lng };
                startNavigation(state.currentDestination, { isReroute: true });
                return;
            }
        }
        
        // Find closest point on route
        let closestIdx = 0;
        let minDist = Infinity;
        state.currentPath.forEach((point, idx) => {
            const dist = haversine(state.userLocation.lat, state.userLocation.lng, point.lat, point.lng);
            if (dist < minDist) {
                minDist = dist;
                closestIdx = idx;
            }
        });
        
        // **DYNAMIC ROUTE RECALCULATION** - If user drifted off route by >30m, recalculate
        const OFF_ROUTE_THRESHOLD = 30; // 30 meters threshold
        if (minDist > OFF_ROUTE_THRESHOLD && state.currentDestination) {
            console.log('[LIVE ROUTE] User drifted', minDist.toFixed(1), 'm off route - RECALCULATING...');
            
            // Recalculate route from current user location to destination
            startNavigation(state.currentDestination);
            return; // Exit and let startNavigation handle the update
        }
        
        // Update heading towards next waypoint (only when gyro is NOT controlling heading)
        if (!state.gyroEnabled && closestIdx < state.currentPath.length - 1) {
            const nextPoint = state.currentPath[closestIdx + 1];
            state.heading = calculateBearing(
                state.userLocation.lat, state.userLocation.lng,
                nextPoint.lat, nextPoint.lng
            );
            
            // Update user marker rotation (GPS-driven heading)
            if (state.userMarker) {
                const icon = state.userMarker.getIcon();
                if (icon && icon.rotation !== undefined) {
                    icon.rotation = state.heading;
                    state.userMarker.setIcon(icon);
                }
            }
        }
        
        // **3D NAVIGATION CAMERA UPDATE**
        if (state.is3DNavigationMode && state.map) {
            try {
                // Update heading to face direction of travel (gyroscope + GPS bearing)
                let heading = state.heading;  // GPS bearing to next waypoint
                
                // If gyroscope is enabled, add device orientation
                if (state.gyroEnabled && state.deviceOrientation && state.deviceOrientation.alpha !== null) {
                    // Combine GPS heading with gyroscope orientation
                    heading = state.heading - (state.deviceOrientation.alpha || 0);
                }
                
                // Heading first, then reposition the camera behind the arrow (true 3rd-person)
                state.map.setHeading(heading);
                updateCamera(state.userLocation, heading);
                
                console.log('[3D CAM] Position:', state.userLocation, 'Heading:', heading, 'Tilt: 67.5°, Zoom: 21, Distance from route:', minDist.toFixed(1) + 'm');
            } catch (error) {
                console.error('[3D CAM] Error updating camera:', error);
            }
        }
        
        // Advance turn-by-turn steps when within 10m of the next waypoint
        if (!state.isInstructionAnimating && state.navigationSteps && state.navigationSteps.length > 0) {
            const activeStep = state.navigationSteps[0];
            const nextWaypointIdx = Math.min(activeStep.index + 1, state.currentPath.length - 1);
            const nextWaypoint = state.currentPath[nextWaypointIdx];
            const waypointDist = haversine(state.userLocation.lat, state.userLocation.lng, nextWaypoint.lat, nextWaypoint.lng);

            if (waypointDist <= 10) {
                advanceNavigationStep();
            }
        }
        
        // Check if arrived
        const destDist = haversine(
            state.userLocation.lat, state.userLocation.lng,
            state.currentDestination.lat, state.currentDestination.lng
        );
        
        if (destDist < 10) {
            document.getElementById('instruction-main').textContent = 'You have arrived!';
            document.getElementById('instruction-distance').textContent = state.currentDestination.name;
            
            // Show arrival notification
            if (!state.arrivalNotificationShown) {
                showNotification(`🎉 You've reached ${state.currentDestination.name}!`, 'success', 5000);
                state.arrivalNotificationShown = true;
                
                // Stop navigation and exit 3D mode after a short delay to let user see the message
                setTimeout(() => {
                    // Exit 3D mode if active
                    if (state.is3DNavigationMode) {
                        cancelThreeDMode();
                    }
                    // Stop navigation
                    stopNavigation();
                }, 3000);
            }
        }
        // nav-arrow overlay removed; no updateNavigationArrow
    }

    function updateNavigationArrow() {
        if (!state.currentPath || state.currentPath.length < 2 || !state.userLocation) return;
        
        // Get next waypoint
        const nextIdx = Math.min(state.currentStepIndex + 1, state.currentPath.length - 1);
        const nextPoint = state.currentPath[nextIdx];
        
        // Calculate bearing to next point
        const bearing = calculateBearing(
            state.userLocation.lat, state.userLocation.lng,
            nextPoint.lat, nextPoint.lng
        );
        
        // Calculate distance
        const distance = haversine(
            state.userLocation.lat, state.userLocation.lng,
            nextPoint.lat, nextPoint.lng
        );
        
        // Rotate arrow (account for device orientation if gyro enabled)
        let rotation = bearing;
        if (state.gyroEnabled && state.deviceOrientation.alpha !== null) {
            rotation = bearing - state.deviceOrientation.alpha;
        }
        
        const arrow = document.getElementById('nav-arrow');
        arrow.style.transform = `rotate(${rotation}deg)`;
        
        document.getElementById('arrow-distance').textContent = formatDistance(distance);
    }

    // Clear all navigation and selection state
    function clearNavigationState() {
        console.log('[STATE] Clearing navigation state...');
        state.currentDestination = null;
        state.pendingDestination = null;
        state.currentPath = [];
        state.currentStepIndex = 0;
        state.navigationSteps = [];
        state.currentStepInstructions = null;
        state.completedSteps = new Set();
        state.is3DNavigationMode = false;
        state.originalDestination = null;
        
        // Clear map polylines
        if (state.currentRoutePolyline) {
            state.currentRoutePolyline.setMap(null);
            state.currentRoutePolyline = null;
        }
        if (state.outsideRoutePolyline) {
            state.outsideRoutePolyline.setMap(null);
            state.outsideRoutePolyline = null;
        }
        if (state.userToRouteConnector) {
            state.userToRouteConnector.setMap(null);
            state.userToRouteConnector = null;
        }
        
        stopRouteArrowAnimation();
        stopConnectorLineAnimation();
        
        // Hide navigation UI
        const navInfo = document.getElementById('navigation-info');
        if (navInfo) navInfo.classList.remove('active');
        
        const navControl = document.getElementById('nav-control');
        if (navControl) navControl.classList.remove('active');
        
        // Hide building preview panel and heatmap
        hideBuildingPreview();
    }

    function cancelNavigation() {
        confirmExit('Cancel this navigation?').then(confirmed => {
            if (confirmed) {
                clearNavigationState();
                
                showAllMarkers();
                showMarkerLabels();
                
                updateStatus('nav-status', 'active');
                const navStatusSpan = document.querySelector('#nav-status span');
                if (navStatusSpan) navStatusSpan.textContent = 'Ready';
                
                showNotification('Navigation cancelled', 'info');
            }
        });
    }

    // ============================================
    // SENSOR FUSION SYSTEM (Google Maps Style)
    // ============================================

    // Sensor fusion state - handles GPS + Compass + Gyro blending
    const sensorFusion = {
        // Position and velocity
        lastPosition: null,
        lastTimestamp: 0,
        gpsSpeed: 0,
        
        // Heading sources
        gpsHeading: 0,
        compassHeading: 0,
        fusedHeading: 0,
        arrowHeading: 0,  // Final heading used for arrow (after map bearing correction)
        isFirstHeadingUpdate: true,  // Flag to initialize fused heading from compass
        
        // Smoothing filters
        headingFilter: 0.7,      // Low-pass filter alpha (0.7 = smooth)
        speedThreshold: 1,       // m/s - above this, trust GPS heading
        
        // Tilt and orientation
        deviceTilt: 0,
        deviceRoll: 0,
        targetTilt: 67.5,        // For 3D mode
        
        // Timestamps for rate limiting
        lastHeadingUpdate: 0,
        lastTiltUpdate: 0,
        headingUpdateRate: 16,   // ms - update heading at ~60fps
        tiltUpdateRate: 50       // ms - update tilt at ~20fps
    };

    // Low-pass filter for smooth heading transitions
    function lowPassFilter(newValue, lastValue, alpha) {
        // Handle 180° wrap-around (compass wraps 0-360)
        let delta = newValue - lastValue;
        if (delta > 180) delta -= 360;
        if (delta < -180) delta += 360;
        
        const filtered = lastValue + delta * alpha;
        return filtered < 0 ? filtered + 360 : filtered % 360;
    }

    // Calculate GPS course heading from position movement
    function calculateGPSHeading(newPos, oldPos) {
        if (!oldPos) return 0;
        
        const dLat = newPos.lat - oldPos.lat;
        const dLng = newPos.lng - oldPos.lng;
        
        // Calculate bearing using atan2
        let heading = Math.atan2(
            dLng * Math.cos(newPos.lat * Math.PI / 180),
            dLat
        ) * 180 / Math.PI;
        
        // Normalize to 0-360
        return heading < 0 ? heading + 360 : heading;
    }

    // Calculate speed from GPS positions
    function calculateSpeed(newPos, oldPos, timeDelta) {
        if (!oldPos || timeDelta === 0) return 0;
        
        const R = 6371000;  // Earth radius in meters
        const dLat = (newPos.lat - oldPos.lat) * Math.PI / 180;
        const dLng = (newPos.lng - oldPos.lng) * Math.PI / 180;
        
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(oldPos.lat * Math.PI / 180) * Math.cos(newPos.lat * Math.PI / 180) *
                Math.sin(dLng / 2) * Math.sin(dLng / 2);
        
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const distance = R * c;
        
        // Speed in m/s
        return distance / (timeDelta / 1000);
    }

    // Prevent 180° wrap-around jumps
    function normalizeHeadingDelta(target, current) {
        let delta = target - current;
        if (delta > 180) delta -= 360;
        if (delta < -180) delta += 360;
        return current + delta;
    }

    // Apply screen orientation correction (portrait vs landscape)
    function correctForScreenOrientation(rawAlpha) {
        // Add 90° to correct for compass vs screen coordinate system
        // This accounts for the fact that compass heading is relative to true north,
        // but screen orientation needs adjustment
        let corrected = (360 - rawAlpha) % 360;
        
        // Normalize to 0-360
        return corrected < 0 ? corrected + 360 : corrected;
    }

    // Subtract map bearing from arrow heading (so arrow is independent of map rotation)
    function adjustHeadingForMapBearing(deviceHeading, mapHeading) {
        let adjusted = deviceHeading - mapHeading;
        
        // Normalize to 0-360
        return adjusted < 0 ? adjusted + 360 : adjusted % 360;
    }

    // Main sensor fusion handler - intelligently blend all sources
    function handleSensorFusion(gpsPos, gpsAltitude, gpsAccuracy, compassHeading, gyroAlpha, gyroBeta, gyroGamma) {
        const now = performance.now();
        
        // ===== GPS PROCESSING =====
        if (gpsPos && sensorFusion.lastPosition) {
            const timeDelta = now - sensorFusion.lastTimestamp;
            
            // Calculate speed from position change
            sensorFusion.gpsSpeed = calculateSpeed(gpsPos, sensorFusion.lastPosition, timeDelta);
            
            // Only use GPS heading if moving (speed > threshold)
            if (sensorFusion.gpsSpeed > sensorFusion.speedThreshold) {
                const newGpsHeading = calculateGPSHeading(gpsPos, sensorFusion.lastPosition);
                
                // Normalize to prevent jumps
                sensorFusion.gpsHeading = normalizeHeadingDelta(newGpsHeading, sensorFusion.gpsHeading);
                
                if (gpsPos) {
                    console.log(`[FUSION] GPS Heading: ${sensorFusion.gpsHeading.toFixed(1)}° | Speed: ${sensorFusion.gpsSpeed.toFixed(2)} m/s (MOVING - using GPS)`);
                }
            }
        }
        
        // Update GPS position memory
        if (gpsPos) {
            sensorFusion.lastPosition = { lat: gpsPos.lat, lng: gpsPos.lng };
            sensorFusion.lastTimestamp = now;
        }
        
        // ===== COMPASS HEADING (from DeviceOrientation) =====
        // Apply screen orientation correction for portrait/landscape
        if (compassHeading !== null && compassHeading !== undefined) {
            const screenCorrected = correctForScreenOrientation(compassHeading);
            sensorFusion.compassHeading = screenCorrected;
        }
        
        // ===== SENSOR FUSION LOGIC =====
        // If moving fast (> 1 m/s): trust GPS + blend with compass for smoothness
        // If stationary (< 1 m/s): trust compass heading DIRECTLY (NO FILTERING)
        
        // Initialize fused heading from compass on first update
        if (sensorFusion.isFirstHeadingUpdate && compassHeading !== null) {
            const screenCorrected = correctForScreenOrientation(compassHeading);
            sensorFusion.fusedHeading = screenCorrected % 360;
            sensorFusion.isFirstHeadingUpdate = false;
        }
        
        let targetHeading = sensorFusion.compassHeading;
        let headingSource = 'COMPASS';
        
        if (sensorFusion.gpsSpeed > sensorFusion.speedThreshold) {
            targetHeading = sensorFusion.gpsHeading;
            headingSource = 'GPS';
        }
        
        // Smooth heading using low-pass filter ONLY if moving
        if (now - sensorFusion.lastHeadingUpdate >= sensorFusion.headingUpdateRate) {
            sensorFusion.lastHeadingUpdate = now;
            
            // When stationary: use compass directly (no lag)
            if (sensorFusion.gpsSpeed <= sensorFusion.speedThreshold) {
                sensorFusion.fusedHeading = sensorFusion.compassHeading;
            } else {
                // When moving: blend GPS heading smoothly
                sensorFusion.fusedHeading = lowPassFilter(
                    targetHeading,
                    sensorFusion.fusedHeading,
                    sensorFusion.headingFilter
                );
            }
            
            // GET CURRENT MAP BEARING
            const mapHeading = state.map ? (state.map.getHeading() || 0) : 0;
            
            // SUBTRACT MAP BEARING from fused heading (so arrow is independent of map rotation)
            const arrowHeading = adjustHeadingForMapBearing(sensorFusion.fusedHeading, mapHeading);
            
            // DEBUG: Log all heading values
            if (sensorFusion.debugCounter === undefined) sensorFusion.debugCounter = 0;
            sensorFusion.debugCounter++;
            
            if (sensorFusion.debugCounter % 60 === 0) {  // Log every ~1 second at 60fps
                console.log(
                    `[ARROW] Raw: ${(compassHeading || 0).toFixed(1)}° | ` +
                    `Screen: ${(sensorFusion.compassHeading).toFixed(1)}° | ` +
                    `Fused: ${(sensorFusion.fusedHeading).toFixed(1)}° | ` +
                    `Map: ${(mapHeading).toFixed(1)}° | ` +
                    `Final: ${(arrowHeading).toFixed(1)}° | ` +
                    `Speed: ${sensorFusion.gpsSpeed.toFixed(2)}m/s`
                );
            }
            
            // Update map heading
            if (state.map) {
                state.map.setHeading(sensorFusion.fusedHeading);
            }
            
            // Store final arrow heading in state for marker rotation
            sensorFusion.arrowHeading = arrowHeading;
        }
        
        // ===== TILT PROCESSING (from accelerometer) =====
        // Use deviceOrientation beta/gamma for tilt calculation
        if (gyroBeta !== null && gyroGamma !== null) {
            // Beta = rotation around X-axis (tilt forward/backward)
            // Clamp to realistic tilt range for 3D mode
            sensorFusion.deviceTilt = Math.max(0, Math.min(gyroBeta, 80));
            sensorFusion.deviceRoll = gyroGamma;
        }
        
        // Update 3D camera tilt smoothly when in 3D mode
        if (state.is3DNavigationMode && state.userLocation) {
            if (now - sensorFusion.lastTiltUpdate >= sensorFusion.tiltUpdateRate) {
                sensorFusion.lastTiltUpdate = now;
                
                // Blend current target tilt with device tilt for responsiveness
                const blendedTilt = sensorFusion.targetTilt;
                
                // Update camera with current heading and tilt
                if (state.map) {
                    const offsetDistance = 40;
                    const radians = (sensorFusion.fusedHeading % 360) * Math.PI / 180;
                    const metersPerDegLat = 111000;
                    const metersPerDegLng = 111000 * Math.max(0.000001, Math.cos(state.userLocation.lat * Math.PI / 180));
                    const offsetLat = (offsetDistance / metersPerDegLat) * Math.cos(radians);
                    const offsetLng = (offsetDistance / metersPerDegLng) * Math.sin(radians);
                    
                    const cameraPosition = {
                        lat: state.userLocation.lat - offsetLat,
                        lng: state.userLocation.lng - offsetLng
                    };
                    
                    state.map.moveCamera({
                        center: cameraPosition,
                        heading: sensorFusion.fusedHeading,
                        tilt: blendedTilt,
                        zoom: 21
                    });
                }
            }
        }
    }

    // Update arrow marker using fused heading
    function updateArrowWithFusedHeading() {
        if (state.userMarker && (state.is3DNavigationMode || state.gyroEnabled)) {
            const icon = state.userMarker.getIcon();
            if (icon && typeof icon === 'object') {
                icon.rotation = sensorFusion.fusedHeading;
                state.userMarker.setIcon(icon);
            }
        }
    }

    // ============================================
    // Gyroscope Integration
    // ============================================

    function initGyroscope() {
        console.log('[GYRO] Initializing gyroscope...');
        startGyro();
    }

    // Corrected 3rd-person camera positioning - camera stays directly behind arrow
    function updateCamera(position, heading) {
        if (!state.map || !position) return;
        
        const offsetDistance = 40;  // meters - distance camera sits behind arrow
        const radians = ((heading % 360) * Math.PI) / 180;  // Convert heading to radians
        
        // forwardVector = (cos(heading), sin(heading))
        // Camera position = userPosition - forwardVector * distance (negative = behind arrow)
        const metersPerDegLat = 111000;
        const metersPerDegLng = 111000 * Math.max(0.000001, Math.cos(position.lat * Math.PI / 180));
        const offsetLat = (offsetDistance / metersPerDegLat) * Math.cos(radians);
        const offsetLng = (offsetDistance / metersPerDegLng) * Math.sin(radians);
        
        const cameraPosition = {
            lat: position.lat - offsetLat,  // Subtract to position behind arrow
            lng: position.lng - offsetLng
        };
        
        // Reposition camera behind arrow with heading locked
        state.map.moveCamera({
            center: cameraPosition,
            heading: heading,
            tilt: 80,
            zoom: 23
        });
    }

    function startGyro() {
        console.log('[GYRO] ============ GYROSCOPE STARTUP ============');
        console.log('[GYRO] URL:', window.location.href);
        console.log('[GYRO] Protocol:', window.location.protocol);
        console.log('[GYRO] Device:', navigator.userAgent);
        
        let eventCount = 0;
        let lastUpdateTime = 0;
        const UPDATE_THROTTLE = 16;  // Update arrow every 16ms (~60 fps) for smooth magnetic lock
        
        function handleOrientation(event) {
            eventCount++;
            
            if (event.alpha !== null) {
                // Store raw device orientation in state
                state.deviceOrientation = {
                    alpha: event.alpha,
                    beta: event.beta,
                    gamma: event.gamma
                };
                
                if (eventCount <= 3) {
                    console.log(`[FUSION] Event #${eventCount}: DeviceOrientation - alpha=${event.alpha.toFixed(2)}°, beta=${event.beta.toFixed(2)}°, gamma=${event.gamma.toFixed(2)}°`);
                }
                
                // ===== FEED COMPASS & GYRO DATA INTO SENSOR FUSION =====
                handleSensorFusion(
                    state.userLocation || sensorFusion.lastPosition,  // Last known GPS position
                    0,  // altitude
                    0,  // accuracy
                    event.alpha % 360,  // Compass heading from DeviceOrientation
                    event.alpha,
                    event.beta,
                    event.gamma
                );
                
                // MAGNETIC LOCK: Update camera with fused heading (real-time)
                if (state.is3DNavigationMode && state.userLocation && state.map) {
                    const offsetDistance = 40;
                    const radians = (sensorFusion.fusedHeading % 360) * Math.PI / 180;
                    const metersPerDegLat = 111000;
                    const metersPerDegLng = 111000 * Math.max(0.000001, Math.cos(state.userLocation.lat * Math.PI / 180));
                    const offsetLat = (offsetDistance / metersPerDegLat) * Math.cos(radians);
                    const offsetLng = (offsetDistance / metersPerDegLng) * Math.sin(radians);
                    
                    const cameraPosition = {
                        lat: state.userLocation.lat - offsetLat,
                        lng: state.userLocation.lng - offsetLng
                    };
                    
                    state.map.moveCamera({
                        center: cameraPosition,
                        heading: sensorFusion.fusedHeading,
                        tilt: 67.5,
                        zoom: 21
                    });
                }
                
                const now = performance.now();
                
                // THROTTLED: Update arrow rotation with corrected heading
                if (now - lastUpdateTime >= UPDATE_THROTTLE) {
                    lastUpdateTime = now;
                    
                    // Update user marker with corrected heading (map bearing already subtracted)
                    if (state.userMarker && (state.is3DNavigationMode || state.gyroEnabled)) {
                        const icon = state.userMarker.getIcon();
                        if (icon && typeof icon === 'object') {
                            icon.rotation = sensorFusion.arrowHeading || 0;  // Corrected heading
                            state.userMarker.setIcon(icon);
                        }
                    }
                }
            }
        }

        // iPhone requires permission
        if (typeof DeviceOrientationEvent !== "undefined" &&
            typeof DeviceOrientationEvent.requestPermission === "function") {
            
            console.log('[GYRO] iOS detected - requesting permission...');
            
            DeviceOrientationEvent.requestPermission()
                .then(permissionState => {
                    console.log('[GYRO] Permission response:', permissionState);
                    
                    if (permissionState === "granted") {
                        console.log('[GYRO] ✓ PERMISSION GRANTED');
                        console.log('[GYRO] Adding deviceorientation listener...');
                        window.addEventListener("deviceorientation", handleOrientation);
                        state.gyroEnabled = true;
                        updateStatus('gyro-status', 'active');
                        const btn = document.getElementById('toggle-gyro-btn');
                        if (btn) btn.classList.add('active');
                        console.log('[GYRO] ✓ READY - Rotate phone and map will follow!');
                    } else {
                        console.error('[GYRO] ❌ Permission', permissionState);
                        showNotification('Permission ' + permissionState + ' - Enable in Settings > Safari > Motion & Orientation', 'error', 5000);
                        updateStatus('gyro-status', 'error');
                    }
                })
                .catch(err => {
                    console.error('[GYRO] ❌ Permission request failed:', err.message);
                    showNotification('Permission error: ' + err.message, 'error');
                    updateStatus('gyro-status', 'error');
                });

        } else {
            // Android & others
            console.log('[GYRO] Non-iOS device detected');
            console.log('[GYRO] Adding deviceorientationabsolute listener...');
            window.addEventListener("deviceorientationabsolute", handleOrientation);
            
            console.log('[GYRO] Adding deviceorientation listener (fallback)...');
            window.addEventListener("deviceorientation", handleOrientation);
            
            state.gyroEnabled = true;
            updateStatus('gyro-status', 'active');
            const btn = document.getElementById('toggle-gyro-btn');
            if (btn) btn.classList.add('active');
            
            console.log('[GYRO] ✓ READY - Rotate phone and map will follow!');
            
            // Check if we're actually receiving events
            setTimeout(() => {
                if (eventCount === 0) {
                    console.warn('[GYRO] ⚠️ No orientation events received yet');
                    console.warn('[GYRO] Check: Chrome Settings > Site Settings > Motion > Allowed');
                    console.warn('[GYRO] Also ensure you\'re using HTTPS (not HTTP)');
                }
            }, 2000);
        }
        
        console.log('[GYRO] ============ STARTUP COMPLETE ============');
    }

    function toggleGyroscope() {
        if (state.gyroEnabled) {
            state.gyroEnabled = false;
            console.log('[GYRO] Disabling gyroscope');
            
            if (state.map) {
                state.map.setHeading(state.heading);  // Reset to GPS heading
            }
            updateStatus('gyro-status', 'warning');
            
            const btn = document.getElementById('toggle-gyro-btn');
            if (btn) btn.classList.remove('active');
        } else {
            console.log('[GYRO] Enabling gyroscope');
            initGyroscope();
        }
    }

    // ============================================
    // 3D View Toggle - DISABLED UNTIL NAVIGATION STARTS
    // ============================================

    function toggle3DView() {
        // 3D view only activates when START is pressed during navigation
        // Cannot manually toggle
        console.warn('[3D] Cannot toggle 3D view manually. Press START to activate 3D navigation.');
        showNotification('Press the START button during navigation to activate 3D view.', 'info');
    }

    // ============================================
    // Search Functionality
    // ============================================

    function performSearch() {
        const searchInput = document.getElementById('location-search');
        const resultsDiv = document.getElementById('search-results');
        if (!searchInput || !resultsDiv) return;

        const query = searchInput.value.toLowerCase().trim();
        resultsDiv.innerHTML = '';
        
        if (!query) {
            resultsDiv.innerHTML = '<div class="result-item" style="color: #94A3B8; cursor: default;">Type a building name to search</div>';
            return;
        }
        
        const campusId = state.campus || 'main';
        const campusConfig = CAMPUS_CONFIG[campusId] || CAMPUS_CONFIG.main;
        const configLocations = (campusConfig && campusConfig.locations) ? campusConfig.locations : [];

        // Check if query is an abbreviation
        let searchQuery = query;
        if (BUILDING_ABBREVIATIONS[query]) {
            searchQuery = BUILDING_ABBREVIATIONS[query].toLowerCase();
        }

        // Prefer config-based search so results work even before map/markers are fully ready
        // Search by both full name and abbreviation
        const foundLocations = configLocations.filter(loc => {
            const locName = (loc.name || '').toLowerCase();
            return locName.includes(searchQuery) || locName.includes(query);
        });

        // If markers exist, map location name -> marker data for instant pan/infowindow
        const markerByName = new Map();
        if (Array.isArray(state.markers) && state.markers.length > 0) {
            state.markers.forEach(item => {
                if (item && item.location && item.location.name) {
                    markerByName.set(item.location.name, item);
                }
            });
        }
        
        if (foundLocations.length > 0) {
            // Enter solo mode when search results are shown
            showScreen('solo-screen');
            
            foundLocations.forEach(loc => {
                const d = document.createElement('div');
                d.className = 'result-item';
                d.textContent = loc.name; // Show full building name
                d.onclick = () => {
                    const markerItem = markerByName.get(loc.name);
                    if (markerItem && state.map) {
                        state.map.setZoom(19);
                        state.map.setCenter(markerItem.marker.getPosition());
                        startNavigation(markerItem.location);
                    } else {
                        // Fallback: ensures map+tracking init happens if needed
                        navigateToBuilding(loc.name);
                    }
                };
                resultsDiv.appendChild(d);
            });
        } else {
            resultsDiv.innerHTML = `<div class="result-item" style="color: #94A3B8; cursor: default;">No results for "${query}"</div>`;
        }
    }

    // ============================================
    // UI Helpers
    // ============================================

    // Navigate to specific screen with confirmation if needed
    function goToScreen(screenId) {
        // If navigating back from solo mode and actively navigating, ask for confirmation
        if (state.currentDestination || state.currentPath.length > 0) {
            const currentScreen = document.querySelector('.screen.active')?.id;
            if (currentScreen === 'solo-screen' || currentScreen === 'interactive-screen') {
                confirmExit('You are actively navigating. Do you want to exit?').then(confirmed => {
                    if (confirmed) {
                        clearNavigationState();
                        showScreen(screenId);
                        showNotification('Navigation ended', 'info');
                    }
                });
                return;
            }
        }
        showScreen(screenId);
    }

    // Confirm exit dialog
    function confirmExit(message) {
        return new Promise((resolve) => {
            // Create modal dialog
            const modal = document.createElement('div');
            modal.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0, 0, 0, 0.5);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 10000;
            `;
            
            const panel = document.createElement('div');
            panel.style.cssText = `
                background: white;
                border-radius: 16px;
                padding: 24px;
                max-width: 320px;
                box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
                text-align: center;
            `;
            
            const title = document.createElement('h3');
            title.textContent = 'Confirm Exit';
            title.style.cssText = 'margin: 0 0 12px 0; font-size: 18px; color: #0F172A;';
            panel.appendChild(title);
            
            const msg = document.createElement('p');
            msg.textContent = message;
            msg.style.cssText = 'margin: 0 0 20px 0; color: #666; font-size: 14px; line-height: 1.4;';
            panel.appendChild(msg);
            
            const buttonContainer = document.createElement('div');
            buttonContainer.style.cssText = 'display: flex; gap: 10px;';
            
            const cancelBtn = document.createElement('button');
            cancelBtn.textContent = 'Cancel';
            cancelBtn.style.cssText = 'flex: 1; padding: 10px; background: #f0f0f0; border: none; border-radius: 8px; cursor: pointer; font-weight: 500;';
            cancelBtn.onclick = () => {
                modal.remove();
                resolve(false);
            };
            
            const confirmBtn = document.createElement('button');
            confirmBtn.textContent = 'Exit';
            confirmBtn.style.cssText = 'flex: 1; padding: 10px; background: #ef4444; color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: 600;';
            confirmBtn.onclick = () => {
                modal.remove();
                resolve(true);
            };
            
            buttonContainer.appendChild(cancelBtn);
            buttonContainer.appendChild(confirmBtn);
            panel.appendChild(buttonContainer);
            modal.appendChild(panel);
            document.body.appendChild(modal);
        });
    }

    function updateStatus(elementId, status) {
        const el = document.getElementById(elementId);
        el.classList.remove('active', 'warning', 'error');
        el.classList.add(status);
    }

    function showScreen(id) {
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        document.getElementById(id).classList.add('active');
    }

    function selectCampus(id) {
        // If already navigating, ask for confirmation
        if (state.currentDestination || state.currentPath.length > 0) {
            confirmExit('You are actively navigating. Do you want to exit and switch campus?').then(confirmed => {
                if (confirmed) {
                    clearNavigationState();
                    state.campus = id;
                    hideBuildingPreview();
                    document.getElementById('selected-campus-badge').textContent = id === 'main' ? 'Main Campus' : 'Botolan Campus';
                    showScreen('mode-screen');
                    showNotification('Campus switched', 'success');
                }
            });
        } else {
            hideBuildingPreview();
            state.campus = id;
            document.getElementById('selected-campus-badge').textContent = id === 'main' ? 'Main Campus' : 'Botolan Campus';
            showScreen('mode-screen');
        }
    }

    function selectMode(mode) {
        // If already navigating, ask for confirmation
        if (state.currentDestination || state.currentPath.length > 0) {
            confirmExit('You are actively navigating. Do you want to exit and switch mode?').then(confirmed => {
                if (confirmed) {
                    clearNavigationState();
                    proceedSelectMode(mode);
                }
            });
        } else {
            proceedSelectMode(mode);
        }
    }
    
    function proceedSelectMode(mode) {
        if (mode === 'interactive') {
            // Show lobby mode selection (create or join)
            showScreen('lobby-mode-screen');
        } else {
            showScreen(`${mode}-screen`);
            if (mode === 'solo') {
                // Increase timeout to ensure DOM is fully rendered
                // Also wait for map container to be visible
                const mapContainer = document.getElementById('solo-map');
                if (mapContainer && mapContainer.offsetHeight > 0) {
                    // Container is ready now
                    initMap();
                    startTracking();
                } else {
                    // Wait longer for container to be visible
                    setTimeout(() => {
                        console.log('[MAP] Initializing map after DOM is ready');
                        try {
                            initMap();
                            startTracking();
                        } catch (error) {
                            console.error('[MAP] Error initializing map:', error);
                            // Retry after additional delay
                            setTimeout(() => {
                                console.log('[MAP] Retrying map initialization');
                                initMap();
                                startTracking();
                            }, 500);
                        }
                    }, 500);
                }
            }
        }
    }

    function createLobby() {
        // Create a new lobby as host
        lobbyState.isHost = true;
        lobbyState.lobbyCode = generateLobbyCode();
        
        // Initialize lobby
        showScreen('interactive-screen');
        setTimeout(() => {
            // Add current user as host
            addParticipant(lobbyState.userName, true);
            
            // Initialize map
            initializeMap();
            addSystemMessage(`Welcome to your lobby! Share code ${lobbyState.lobbyCode} with others.`);
        // addSystemMessage('Click "Share Location" to show your position on the map.');
            
            // Update UI
            document.getElementById('lobbyCodeDisplay').textContent = lobbyState.lobbyCode;
        }, 100);
    }

    function showJoinLobbyModal() {
        const modal = document.getElementById('joinLobbyModal');
        modal.classList.remove('hidden');
        document.getElementById('joinLobbyCode').focus();
    }

    function closeJoinLobbyModal() {
        const modal = document.getElementById('joinLobbyModal');
        modal.classList.add('hidden');
        document.getElementById('joinLobbyCode').value = '';
    }

    function joinLobby() {
        const code = document.getElementById('joinLobbyCode').value.trim().toUpperCase();
        
        if (!code) {
            showNotification('Please enter a lobby code', 'warning');
            return;
        }
        
        if (code.length !== 6) {
            showNotification('Lobby code must be 6 characters', 'warning');
            return;
        }
        
        // In a real application, validate code with server
        // For now, just accept any valid format
        lobbyState.isHost = false;
        lobbyState.lobbyCode = code;
        
        closeJoinLobbyModal();
        
        // Initialize lobby as guest
        showScreen('interactive-screen');
        setTimeout(() => {
            // Add current user as guest
            addParticipant(lobbyState.userName, false);
            
            // Initialize map
            initializeMap();
            addSystemMessage(`Joined lobby ${lobbyState.lobbyCode}`);
            
            // Auto-start location sharing for members too
            console.log('[JOIN-LOBBY] Auto-starting location sharing for member...');
            toggleLocationSharing();
            
            // Update UI
            document.getElementById('lobbyCodeDisplay').textContent = lobbyState.lobbyCode;
        }, 100);
    }

    function generateLobbyCode() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let code = '';
        for (let i = 0; i < 6; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return code;
    }

    function centerOnUser() {
        if (!state.map || !state.userLocation) {
            showNotification('GPS data not available yet. Please wait...', 'info', 3000);
            return;
        }
        
        // Check if user is within campus bounds
        const isWithinCampus = isInsideCampus(state.userLocation.lat(), state.userLocation.lng());
        
        if (!isWithinCampus) {
            showNotification('You are outside the campus. Cannot center on location.', 'warning', 4000);
            return;
        }
        
        // Center map on user location
        state.map.panTo(state.userLocation);
        state.map.setZoom(19);
    }

    function toggleSidebar() {
        const sidebar = document.getElementById('sidebar');
        const layout = document.querySelector('.app-layout');
        const isMobile = window.innerWidth <= 900;

        if (isMobile) {
            // On mobile, toggle the 'open' class for slide-out behavior
            sidebar.classList.toggle('open');
        } else {
            // On desktop, toggle the 'collapsed' class for width change
            sidebar.classList.toggle('collapsed');
            layout.classList.toggle('sidebar-collapsed');
            
            // Trigger map resize when sidebar state changes
            if (state.map) {
                setTimeout(() => {
                    google.maps.event.trigger(state.map, 'resize');
                }, 300); // Wait for CSS transition
            }
        }
    }

    // ============================================
    // Map Controls
    // ============================================
    function zoomIn() {
        // Works for both solo and interactive modes
        const map = state.map || lobbyState.map;
        if (!map) {
            console.error('[ZOOM] No map available - state.map:', !!state.map, 'lobbyState.map:', !!lobbyState.map);
            return;
        }
        const zoom = map.getZoom();
        map.setZoom(zoom + 1);  
        console.log('[ZOOM] Zoomed in to level:', zoom + 1);
    }

    function zoomOut() {
        // Works for both solo and interactive modes
        const map = state.map || lobbyState.map;
        if (!map) {
            console.error('[ZOOM] No map available - state.map:', !!state.map, 'lobbyState.map:', !!lobbyState.map);
            return;
        }
        const zoom = map.getZoom();
        map.setZoom(zoom - 1);
        console.log('[ZOOM] Zoomed out to level:', zoom - 1);
    }

    function toggleMapType() {
        console.log('[MAP-TYPE] toggleMapType called');
        // Works for both solo and interactive modes
        const map = state.map || lobbyState.map;
        if (!map) {
            console.error('[MAP-TYPE] No map available - state.map:', !!state.map, 'lobbyState.map:', !!lobbyState.map);
            return;
        }
        
        const currentType = map.getMapTypeId();
        const newType = currentType === 'satellite' ? 'roadmap' : 'satellite';
        map.setMapTypeId(newType);
        console.log('[MAP-TYPE] Changed from', currentType, 'to', newType);
        
        // Update button visual state (for solo mode)
        const toggleMapTypeBtn = document.getElementById('toggle-map-type-btn');
        if (toggleMapTypeBtn) {
            toggleMapTypeBtn.classList.toggle('active', newType === 'satellite');
        }
    }

    function start3DNavigation() {
        // Check if 3D mode is already active - if so, STOP it
        if (state.is3DNavigationMode) {
            console.log('[⭐ STOP] Stopping 3D mode');
            cancelThreeDMode();
            return;
        }

        // If a building was selected (marker clicked) but not yet navigating, start it now
        if (state.pendingDestination && !state.currentDestination) {
            document.getElementById('building-overview').style.display = 'none';
            startNavigation(state.pendingDestination);
            state.pendingDestination = null;
            // Continue with 3D mode activation below
        }

        // Check if user is outside campus - prevent starting navigation
        if (state.userLocation && !isInsideCampus(state.userLocation.lat, state.userLocation.lng)) {
            console.log('[⭐ START] ✗ User is outside campus - navigation blocked');
            showNotification('You must be inside the campus to start navigation!', 'warning');
            return;
        }

        try {
            console.log('[⭐ START] Button clicked - Activating 3D navigation!');
            
            // First check: Is there already an active navigation route?
            if (state.currentPath && Array.isArray(state.currentPath) && state.currentPath.length > 0) {
                console.log('[⭐ START] ✓ Route found - Tilting to 3D view NOW');
                activateThreeDMode();
                return;
            }
            
            console.log('[⭐ START] ✗ No active route, checking search...');
            
            // Second check: Is there a search query?
            const searchInput = document.getElementById('location-search');
            if (!searchInput) {
                console.log('[⭐ START] ✗ Search input not found');
                showNotification('Please select a building first!', 'warning');
                return;
            }
            
            const query = searchInput.value ? searchInput.value.trim() : '';
            console.log('[⭐ START] Search query:', query);
            
            if (!query) {
                console.log('[⭐ START] ✗ Empty search query');
                showNotification('Please search for a building first!', 'warning');
                return;
            }
            
            // Try to find a matching building
            if (!state.markers || !Array.isArray(state.markers)) {
                console.log('[⭐ START] ✗ No markers available');
                showNotification('Please select a building first!', 'warning');
                return;
            }
            
            const matching = state.markers.filter(m => 
                m.location && 
                m.location.name && 
                m.location.name.toLowerCase().includes(query.toLowerCase())
            );
            
            console.log('[⭐ START] Found', matching.length, 'matching buildings');
            
            if (matching.length === 0) {
                console.log('[⭐ START] ✗ No matching buildings');
                showNotification(`No buildings found matching "${query}"`, 'warning');
                return;
            }
            
            const building = matching[0];
            console.log('[⭐ START] Starting navigation to:', building.location.name);
            
            // Start the navigation
            startNavigation(building.location);
            
            // Tilt to 3D mode AFTER route is drawn
            setTimeout(() => {
                activateThreeDMode();
            }, 800);
            
        } catch (error) {
            console.error('[⭐ START] ERROR:', error);
            showNotification('Error: ' + error.message, 'error', 6000);
        }
    }

    function activateThreeDMode() {
        console.log('[⭐ 3D MODE] TILTING NOW on START button press');
        
        state.is3DNavigationMode = true;
        
        if (!state.map) {
            console.error('[⭐ 3D MODE] Map not available');
            return;
        }

        // **HIDE MARKERS AND LOCATIONS WHEN 3D STARTS**
        hideAllMarkers();
        hideMarkerLabels();
        closeAllInfoWindows();
        hideSearchResults();

        // Style walkable route lines for 3D mode
        styleWalkableRoutesFor3D();

        // Animate user's route polyline with arrows
        if (state.currentRoutePolyline) {
            startRouteArrowAnimation();
        }
        
        // Also animate connector line if it exists
        if (state.userToRouteConnector) {
            startConnectorLineAnimation();
        }
        
        try {
            // Position camera behind arrow for true 3rd-person view using fused heading
            if (state.userLocation) {
                const heading = sensorFusion.fusedHeading || sensorFusion.compassHeading || 0;
                const offsetDistance = 40;
                const radians = (heading % 360) * Math.PI / 180;
                const metersPerDegLat = 111000;
                const metersPerDegLng = 111000 * Math.max(0.000001, Math.cos(state.userLocation.lat * Math.PI / 180));
                const offsetLat = (offsetDistance / metersPerDegLat) * Math.cos(radians);
                const offsetLng = (offsetDistance / metersPerDegLng) * Math.sin(radians);
                
                const cameraPosition = {
                    lat: state.userLocation.lat - offsetLat,
                    lng: state.userLocation.lng - offsetLng
                };

                const currentCenter = state.map.getCenter();
                const from = {
                    center: currentCenter ? { lat: currentCenter.lat(), lng: currentCenter.lng() } : { lat: cameraPosition.lat, lng: cameraPosition.lng },
                    zoom: typeof state.map.getZoom === 'function' ? (state.map.getZoom() || 18) : 18,
                    tilt: typeof state.map.getTilt === 'function' ? (state.map.getTilt() || 0) : 0,
                    heading: typeof state.map.getHeading === 'function' ? (state.map.getHeading() || 0) : 0
                };
                const to = {
                    center: cameraPosition,
                    zoom: 23,
                    tilt: 80,
                    heading: heading
                };

                animateMapCamera(state.map, from, to, 1100);
            } else {
                // Fallback if location not available yet
                const heading = sensorFusion.fusedHeading || 0;
                const currentCenter = state.map.getCenter();
                const center = currentCenter ? { lat: currentCenter.lat(), lng: currentCenter.lng() } : { lat: 0, lng: 0 };
                const from = {
                    center,
                    zoom: typeof state.map.getZoom === 'function' ? (state.map.getZoom() || 18) : 18,
                    tilt: typeof state.map.getTilt === 'function' ? (state.map.getTilt() || 0) : 0,
                    heading: typeof state.map.getHeading === 'function' ? (state.map.getHeading() || 0) : 0
                };
                const to = {
                    center,
                    zoom: 23,
                    tilt: 80,
                    heading
                };

                animateMapCamera(state.map, from, to, 1100);
            }
            
            console.log('[⭐ 3D MODE] ✓ 3D view activated - Tilt: 80°, Zoom: 23 (MAX), Camera behind arrow with sensor fusion');
            console.log('[⭐ 3D MODE] ✓ Sensor fusion active: GPS + Compass + Gyro blended');
        } catch (e) {
            console.warn('[⭐ 3D MODE] Could not set tilt/zoom:', e);
        }
        
        // **ENABLE 3D TOUCH/SCROLL CONTROLS**
        enable3DMapControls();
        
        // Enable gyroscope for heading sync
        if (!state.gyroEnabled) {
            console.log('[⭐ 3D MODE] Enabling gyroscope for heading sync...');
            initGyroscope();
        } else {
            console.log('[⭐ 3D MODE] Gyroscope already enabled');
        }
        
        // Update button visuals - Change to STOP
        const startBtn = document.getElementById('start-nav-btn');
        if (startBtn) {
            startBtn.classList.add('active');
            startBtn.innerHTML = '<span>STOP</span>';
            startBtn.title = 'Stop 3D Navigation';
        }
        
        // Broadcast to multiplayer
        broadcastNavigationStart();
        
        console.log('[⭐ 3D MODE] ✓ 3D Navigation Mode ACTIVE!');
        console.log('[⭐ 3D MODE] Camera locked: 67.5° tilt, 21x zoom, GPS + Gyroscope heading');
    }

    function cancelThreeDMode() {
        console.log('[⭐ STOP] Exiting 3D mode');
        
        state.is3DNavigationMode = false;

        if (state.cameraAnimFrameId) {
            cancelAnimationFrame(state.cameraAnimFrameId);
            state.cameraAnimFrameId = null;
        }
        
        // **DISABLE 3D TOUCH/SCROLL CONTROLS**
        disable3DMapControls();

        // Restore walkable route styling
        restoreRouteStyling();

        // Stop route arrow animation
        stopRouteArrowAnimation();
        
        if (state.map) {
            try {
                // Return to normal 2D view with correct heading synced to arrow
                state.map.setTilt(0);
                state.map.setZoom(18);
                state.map.setHeading(sensorFusion.fusedHeading);  // Sync to fused heading (arrow uses this)
                
                // Pan to current location
                if (state.userLocation) {
                    state.map.panTo({
                        lat: state.userLocation.lat,
                        lng: state.userLocation.lng
                    });
                }
                
                console.log('[⭐ STOP] ✓ Returned to 2D view - Tilt: 0°, Zoom: 18, Heading: ' + sensorFusion.fusedHeading.toFixed(1) + '°');
            } catch (e) {
                console.warn('[⭐ STOP] Could not reset camera:', e);
            }
        }
        
        // **SHOW MARKERS AND LOCATIONS AGAIN WHEN EXITING 3D**
        showAllMarkers();
        showMarkerLabels();
        
        // Update button visuals - Change back to START
        const startBtn = document.getElementById('start-nav-btn');
        if (startBtn) {
            startBtn.classList.remove('active');
            startBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg><span>START</span>';
            startBtn.title = 'Start 3D Navigation';
        }
        
        console.log('[⭐ STOP] ✓ 3D Navigation Mode DEACTIVATED');
    }

    function showStartGuide() {
        showNotification('How to Start: Type a building name, click START — or choose a building and press START.', 'info', 8000);
    }

    // ============================================
    // 3D NAVIGATION HELPER FUNCTIONS
    // ============================================

    // Hide all markers when entering 3D mode
    function hideAllMarkers() {
        if (state.markers && state.markers.length > 0) {
            state.markers.forEach(item => {
                // Preserve destination marker: do not hide the marker that matches currentDestination
                const isDestination = state.currentDestination && item.location &&
                    (item.location.lat === state.currentDestination.lat && item.location.lng === state.currentDestination.lng);
                if (isDestination) return; // keep destination visible
                if (item && item.marker && typeof item.marker.setVisible === 'function') {
                    item.marker.setVisible(false);
                }
            });
        }
        console.log('[3D HELPERS] All markers hidden');
    }

    // Show all markers when exiting 3D mode
    function showAllMarkers() {
        if (state.markers && state.markers.length > 0) {
            state.markers.forEach(item => {
                if (item && item.marker && typeof item.marker.setVisible === 'function') {
                    item.marker.setVisible(true);
                }
            });
        }
        console.log('[3D HELPERS] All markers shown');
    }

    // Style walkable route lines for 3D mode: transparent white overlay
    function styleWalkableRoutesFor3D() {
        if (state.walkableRoutePolylines && state.walkableRoutePolylines.length > 0) {
            state.walkableRoutePolylines.forEach(pl => {
                if (!pl) return;
                pl.setOptions({
                    strokeColor: '#FFFFFF',
                    strokeOpacity: 0.15,
                    strokeWeight: 3
                });
            });
        }
    }

    // Restore route styling when leaving 3D mode
    function restoreRouteStyling() {
        if (state.walkableRoutePolylines && state.walkableRoutePolylines.length > 0) {
            state.walkableRoutePolylines.forEach(pl => {
                if (!pl) return;
                pl.setOptions({
                    strokeColor: '#2196F3',
                    strokeOpacity: 0.9,
                    strokeWeight: 5
                });
            });
        }
    }

    // Hide marker labels
    function hideMarkerLabels() {
        const labels = document.querySelectorAll('.marker-label');
        labels.forEach(label => {
            const isDestination = state.currentDestination && label && label.dataset &&
                (label.dataset.locationName === state.currentDestination.name);
            if (isDestination) return;
            label.style.opacity = '0';
            label.style.pointerEvents = 'none';
            label.style.display = 'none';
        });
        console.log('[3D HELPERS] Marker labels hidden');
    }

    // Show marker labels
    function showMarkerLabels() {
        const labels = document.querySelectorAll('.marker-label');
        labels.forEach(label => {
            label.style.opacity = '1';
            label.style.pointerEvents = 'auto';
            label.style.display = 'block';
        });
        console.log('[3D HELPERS] Marker labels shown');
    }

    // Close all info windows
    function closeAllInfoWindows() {
        if (state.markers && state.markers.length > 0) {
            state.markers.forEach(item => {
                if (item && item.infoWindow && typeof item.infoWindow.close === 'function') {
                    item.infoWindow.close();
                }
            });
        }
        console.log('[3D HELPERS] All info windows closed');
    }

    // Hide search results
    function hideSearchResults() {
        const searchResults = document.getElementById('search-results');
        if (searchResults) {
            searchResults.style.display = 'none';
        }
        console.log('[3D HELPERS] Search results hidden');
    }

    // Show search results
    function showSearchResults() {
        const searchResults = document.getElementById('search-results');
        if (searchResults) {
            searchResults.style.display = 'block';
        }
        console.log('[3D HELPERS] Search results shown');
    }

    // Enable 3D map touch and scroll controls for tilt/zoom like Google Maps
    function enable3DMapControls() {
        const mapContainer = document.getElementById('solo-map');
        if (!mapContainer) {
            console.warn('[3D CONTROLS] Map container not found');
            return;
        }

        // Store current tilt for touch gesture
        let initialTilt = 67.5;
        let touchStartY = 0;
        let touchStartTilt = initialTilt;

        // Two-finger touch for tilt (pinch to zoom, drag up/down for tilt)
        mapContainer.addEventListener('touchmove', (e) => {
            if (!state.is3DNavigationMode || !state.map) return;

            // Two-finger touch for tilt adjustment
            if (e.touches.length === 2) {
                e.preventDefault();

                // Get current tilt
                const currentTilt = state.map.getTilt() || initialTilt;

                // Calculate touch distance
                const touch1 = e.touches[0];
                const touch2 = e.touches[1];
                const distance = Math.abs(touch1.clientY - touch2.clientY);
                const avgY = (touch1.clientY + touch2.clientY) / 2;

                // Store for comparison in next event
                if (!mapContainer.dataset.lastTouchDistance) {
                    mapContainer.dataset.lastTouchDistance = distance;
                    mapContainer.dataset.lastAvgY = avgY;
                    return;
                }

                const lastDistance = parseFloat(mapContainer.dataset.lastTouchDistance);
                const lastAvgY = parseFloat(mapContainer.dataset.lastAvgY);

                // Pinch gesture for zoom
                const distDelta = distance - lastDistance;
                if (Math.abs(distDelta) > 5) {
                    const currentZoom = state.map.getZoom() || 21;
                    const newZoom = Math.max(19, Math.min(21, currentZoom + (distDelta > 0 ? 0.2 : -0.2)));
                    state.map.setZoom(newZoom);
                    console.log('[3D GESTURE] Pinch zoom:', newZoom.toFixed(1));
                }

                // Drag up/down for tilt
                const yDelta = avgY - lastAvgY;
                if (Math.abs(yDelta) > 10) {
                    const newTilt = Math.max(0, Math.min(85, currentTilt - (yDelta / 100) * 45));
                    state.map.setTilt(newTilt);
                    console.log('[3D GESTURE] Tilt adjusted:', newTilt.toFixed(1) + '°');
                }

                mapContainer.dataset.lastTouchDistance = distance;
                mapContainer.dataset.lastAvgY = avgY;
            }
        }, { passive: false });

        // Mouse wheel for tilt/zoom
        mapContainer.addEventListener('wheel', (e) => {
            if (!state.is3DNavigationMode || !state.map) return;

            // Check if Ctrl is pressed for zoom, otherwise tilt
            if (e.ctrlKey) {
                // Zoom
                e.preventDefault();
                const currentZoom = state.map.getZoom() || 23;
                const newZoom = Math.max(19, Math.min(23, currentZoom + (e.deltaY > 0 ? -0.3 : 0.3)));
                state.map.setZoom(newZoom);
                console.log('[3D GESTURE] Scroll zoom (Ctrl):', newZoom.toFixed(1));
            } else {
                // Tilt
                e.preventDefault();
                const currentTilt = state.map.getTilt() || 80;
                const newTilt = Math.max(0, Math.min(85, currentTilt + (e.deltaY > 0 ? 3 : -3)));
                state.map.setTilt(newTilt);
                console.log('[3D GESTURE] Scroll tilt:', newTilt.toFixed(1) + '°');
            }
        }, { passive: false });

        console.log('[3D CONTROLS] ✓ 3D touch/scroll controls enabled - Pinch to zoom, two-finger drag for tilt, wheel to tilt, Ctrl+wheel to zoom');
    }

    // Disable 3D map controls
    function disable3DMapControls() {
        const mapContainer = document.getElementById('solo-map');
        if (!mapContainer) return;
        
        // Clear touch data
        mapContainer.dataset.lastTouchDistance = '';
        mapContainer.dataset.lastAvgY = '';
        console.log('[3D CONTROLS] 3D controls disabled');
    }

    // ============================================
    // Multiplayer Features
    // ============================================

    function initializeSocket() {
        // Check if Socket.IO library is loaded
        if (typeof io === 'undefined') {
            console.log('[Socket.IO] Not available, skipping multiplayer features');
            return;
        }
        
        try {
            // Determine server URL for Socket.IO connection
            let socketURL = window.socketIOConfig?.url || '/';
            
            console.log('[Socket.IO] Connecting to:', socketURL);
            
            // Initialize Socket.IO connection with explicit URL
            window.socket = io(socketURL, {
                reconnection: true,
                reconnectionDelay: 1000,
                reconnectionDelayMax: 5000,
                reconnectionAttempts: 5,
                transports: ['websocket', 'polling']
            });
            
            // Connection event handlers
            window.socket.on('connect', () => {
                console.log('[Socket.IO] Connected to server:', window.socket.id);
                state.socketId = window.socket.id;
                
                // Update GPS status
                updateStatus('gps-status', 'active');
            });
            
            window.socket.on('disconnect', () => {
                console.log('[Socket.IO] Disconnected from server');
                updateStatus('gps-status', 'warning');
            });
            
            // Listen for other users' location updates
            window.socket.on('userLocationUpdate', (data) => {
                console.log('[Socket.IO] Received location update from:', data.userId);
                updateOtherUserMarker(data);
            });
            
            // Listen for navigation start events
            window.socket.on('navigationStarted', (data) => {
                console.log('[Socket.IO] User started navigation:', data.userId);
            });
            
        } catch (error) {
            console.error('[Socket.IO] Initialization error:', error);
        }
    }

    function updateOtherUserMarker(data) {
        // Determine which map and markers object to use
        const isLobbyMode = lobbyState && lobbyState.map && lobbyState.isLocationSharing;
        const map = isLobbyMode ? lobbyState.map : state.map;
        const markersObject = isLobbyMode ? lobbyState.userMarkers : state.otherUserMarkers;
        
        if (!map || !data.lat || !data.lng) {
            console.warn('[MARKER] No map available or missing location data', { map: !!map, data });
            return;
        }
        
        console.log('[MARKER] Updating marker for user:', data.userId, 'at', data.lat, data.lng);
        
        // Check if user already has a marker
        let userMarker = markersObject?.[data.userId];
        
        if (!userMarker) {
            // Create new marker for other user
            userMarker = new google.maps.Marker({
                position: { lat: data.lat, lng: data.lng },
                map: map,
                title: data.userId,
                icon: {
                    path: google.maps.SymbolPath.CIRCLE,
                    scale: isLobbyMode ? 13 : 4,
                    fillColor: isLobbyMode ? '#10B981' : '#3B82F6',
                    fillOpacity: isLobbyMode ? 1 : 0.6,
                    strokeColor: '#ffffff',
                    strokeWeight: 3
                },
                animation: google.maps.Animation.DROP,
                zIndex: 999
            });
            
            // Add info window for other users
            const infoWindow = new google.maps.InfoWindow({
                content: `
                    <div style="padding: 8px; text-align: center;">
                        <strong style="color: #0F172A;">${data.userId}</strong>
                        <p style="margin: 4px 0 0 0; color: #10B981; font-size: 0.8rem; font-weight: 600;">● Online</p>
                    </div>
                `,
                pixelOffset: new google.maps.Size(0, -35)
            });
            
            userMarker.addListener('click', () => {
                infoWindow.open(map, userMarker);
            });
            
            markersObject[data.userId] = userMarker;
            console.log('[MARKER] Created marker for user:', data.userId);
        } else {
            // Update existing marker position
            console.log('[MARKER] Updating existing marker for user:', data.userId);
            userMarker.setPosition({ lat: data.lat, lng: data.lng });
            
            // Update rotation if heading is provided
            if (data.heading !== undefined) {
                userMarker.setIcon({
                    path: google.maps.SymbolPath.CIRCLE,
                    scale: isLobbyMode ? 13 : 4,
                    fillColor: isLobbyMode ? '#10B981' : '#3B82F6',
                    fillOpacity: isLobbyMode ? 1 : 0.6,
                    strokeColor: '#ffffff',
                    strokeWeight: 3,
                    rotation: data.heading
                });
            }
        }
    }

    function broadcastNavigationStart() {
        if (window.socket && window.socket.connected) {
            window.socket.emit('navigationStart', {
                userId: state.user || 'Anonymous',
                destination: state.currentDestination,
                timestamp: new Date()
            });
        }
    }

    function broadcastUserLocation() {
        if (window.socket && window.socket.connected && state.userLocation) {
            const lat = typeof state.userLocation.lat === 'function' ? state.userLocation.lat() : state.userLocation.lat;
            const lng = typeof state.userLocation.lng === 'function' ? state.userLocation.lng() : state.userLocation.lng;
            
            window.socket.emit('locationUpdate', {
                userId: state.user || 'Anonymous',
                lat: lat,
                lng: lng,
                heading: state.deviceOrientation?.alpha || 0,
                timestamp: new Date()
            });
        }
    }

    // ============================================
    // Buildings Menu Population
    // ============================================

    function populateBuildingsMenu() {
        const buildingsGrid = document.getElementById('buildings-grid');
        if (!buildingsGrid) return;
        
        const locations = CAMPUS_CONFIG.main.locations;
        
        buildingsGrid.innerHTML = locations.map((building, index) => {
            const hasImage = building.image && building.image.trim().length > 0;
            const hasDescription = building.description && building.description.trim().length > 0;
            
            return `
                <div class="building-card">
                    <div class="building-image">
                        ${hasImage ? `<img src="${building.image}" alt="${building.name}" onerror="this.style.display='none'">` : '<svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-4"/><path d="M9 9v.01"/><path d="M9 12v.01"/><path d="M9 15v.01"/><path d="M9 18v.01"/></svg>'}
                    </div>
                    <div class="building-content">
                        <h3 class="building-name">${building.name}</h3>
                        ${hasDescription ? `<p class="building-description">${building.description}</p>` : '<p class="building-description" style="color: var(--gray-400); font-style: italic;">No description available</p>'}
                        <div class="building-footer">
                            <button class="building-btn" onclick="navigateToBuilding('${building.name}')">
                                Navigate
                            </button>
                            <button class="building-btn primary" onclick="viewBuildingDetails('${building.name}', '${building.description.replace(/'/g, "\\'")}')">
                                View
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    function viewBuildingDetails(name, description) {
        // For now, just show an alert. You can enhance this with a modal
        showNotification(`${name}: ${description || 'No description available'}`, 'info', 8000);
    }

    function navigateToBuilding(buildingName) {
        // Ensure main campus is selected
        state.campus = 'main';
        
        // Find the building in config
        const building = CAMPUS_CONFIG.main.locations.find(loc => loc.name === buildingName);
        if (!building) {
            showNotification('Building not found', 'warning', 5000);
            return;
        }
        
        // Show the solo screen and initialize map
        showScreen('solo-screen');
        
        // Wait for DOM to be ready, then initialize map and navigation
        setTimeout(() => {
            const mapContainer = document.getElementById('solo-map');
            if (mapContainer && mapContainer.offsetHeight > 0) {
                // Container is ready
                initMap();
                startTracking();
                
                // Start navigation after brief delay to ensure map is fully initialized
                setTimeout(() => {
                    startNavigation(building);
                }, 500);
            } else {
                // Retry if container not visible
                setTimeout(() => {
                    initMap();
                    startTracking();
                    setTimeout(() => {
                        startNavigation(building);
                    }, 500);
                }, 300);
            }
        }, 100);
    }

    // ============================================
    // Event Listeners
    // ============================================

    document.addEventListener('DOMContentLoaded', () => {
        // Debug info for testing
        console.log('════════════════════════════════════════════════');
        console.log('🗺️  PRMSU Campus Navigator');
        console.log('════════════════════════════════════════════════');
        console.log('Current URL:', window.location.href);
        console.log('');
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            console.warn('%c⚠️  TESTING ON PHONE? Read Below!', 'color: red; font-size: 16px; font-weight: bold');
            console.warn('Localhost does NOT work on your phone!');
            console.log('');
            console.log('%cFIND YOUR COMPUTER IP:', 'color: blue; font-weight: bold');
            console.log('Windows: Open PowerShell, run: ipconfig');
            console.log('Look for "IPv4 Address" (e.g., 192.168.1.100)');
            console.log('');
            console.log('%cVISIT FROM PHONE:', 'color: green; font-weight: bold');
            console.log('https://YOUR_COMPUTER_IP:3000');
            console.log('Example: https://192.168.1.100:3000');
            console.log('');
            console.log('%cREMEMBER:', 'color: orange; font-weight: bold');
            console.log('✓ Must be on SAME WiFi network');
            console.log('✓ Must use HTTPS (not HTTP)');
            console.log('✓ Accept self-signed certificate warning');
        }
        console.log('════════════════════════════════════════════════');
        
        // Initialize Socket.IO for multiplayer features
        initializeSocket();
        
        // Populate buildings menu
        populateBuildingsMenu();
        
        // Load saved username from localStorage
        const savedUsername = localStorage.getItem('prmsuUsername');
        if (savedUsername) {
            state.user = savedUsername;
            const userStatusDisplay = document.getElementById('user-status-display');
            if (userStatusDisplay) userStatusDisplay.textContent = `Welcome, ${state.user}`;
            
            // Skip registration modal and go to hero
            const regModal = document.getElementById('registration-modal');
            setTimeout(() => {
                if (regModal) regModal.style.display = 'none';
                const heroLanding = document.getElementById('hero-landing');
                if (heroLanding) heroLanding.style.display = 'grid';
            }, 100);
            
            console.log('[AUTH] Username loaded from device:', state.user);
        } else {
            // Show registration modal for new users
            setTimeout(() => {
                const regModal = document.getElementById('registration-modal');
                if (regModal) regModal.classList.add('active');
            }, 100);
        }
        
        // Registration
        const saveNameBtn = document.getElementById('save-name-btn');
        if (saveNameBtn) {
            saveNameBtn.addEventListener('click', () => {
                const displayName = document.getElementById('display-name');
                const userStatusDisplay = document.getElementById('user-status-display');
                const regModal = document.getElementById('registration-modal');
                const heroLanding = document.getElementById('hero-landing');
                
                if (displayName && displayName.value.trim()) {
                    state.user = displayName.value.trim();
                    // Save to localStorage for IP-based persistence
                    localStorage.setItem('prmsuUsername', state.user);
                    console.log('[AUTH] Username saved:', state.user);
                    
                    if (userStatusDisplay) userStatusDisplay.textContent = `Welcome, ${state.user}`;
                    if (regModal) regModal.classList.remove('active');
                    setTimeout(() => {
                        if (regModal) regModal.style.display = 'none';
                        if (heroLanding) heroLanding.style.display = 'grid';
                    }, 300);
                } else if (displayName) {
                    displayName.focus();
                }
            });
        }
        
        const displayName = document.getElementById('display-name');
        if (displayName) {
            displayName.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    const saveBtn = document.getElementById('save-name-btn');
                    if (saveBtn) saveBtn.click();
                }
            });
        }

        // Change username functionality
        const changeUsernameBtn = document.getElementById('change-username-btn');
        if (changeUsernameBtn) {
            changeUsernameBtn.addEventListener('click', () => {
                const modal = document.getElementById('changeUsernameModal');
                const input = document.getElementById('newUsernameInput');
                if (modal && input) {
                    modal.classList.remove('hidden');
                    modal.style.display = 'flex';
                    input.value = state.user || '';
                    input.focus();
                    input.select();
                }
            });
        }
        
        // Hero start button
        const startMappingBtn = document.getElementById('start-mapping-btn');
        if (startMappingBtn) {
            startMappingBtn.addEventListener('click', () => {
                const heroLanding = document.getElementById('hero-landing');
                if (heroLanding) heroLanding.style.display = 'none';
                showScreen('campus-screen');
            });
        }
        
        // Search
        const searchBtn = document.getElementById('search-btn');
        if (searchBtn) searchBtn.addEventListener('click', performSearch);
        
        const locationSearch = document.getElementById('location-search');
        if (locationSearch) {
            // Live search: trigger on every keystroke
            locationSearch.addEventListener('input', performSearch);
            // Also support Enter key
            locationSearch.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') performSearch();
            });
        }
        
        // Navigation controls
        const cancelNavBtn = document.getElementById('cancel-nav-btn');
        if (cancelNavBtn) cancelNavBtn.addEventListener('click', cancelNavigation);
        
        // Map Control Buttons
        const zoomInBtn = document.getElementById('zoom-in-btn');
        if (zoomInBtn) zoomInBtn.addEventListener('click', zoomIn);
        
        const zoomOutBtn = document.getElementById('zoom-out-btn');
        if (zoomOutBtn) zoomOutBtn.addEventListener('click', zoomOut);
        
        const toggleMapTypeBtn = document.getElementById('toggle-map-type-btn');
        if (toggleMapTypeBtn) toggleMapTypeBtn.addEventListener('click', toggleMapType);
        
        const startNavBtn = document.getElementById('start-nav-btn');
        if (startNavBtn) startNavBtn.addEventListener('click', start3DNavigation);
        
        // Mobile sidebar
        const mobileMenuBtn = document.getElementById('mobile-menu-btn');
        if (mobileMenuBtn) mobileMenuBtn.addEventListener('click', toggleSidebar);
        
        const toggleSidebarBtn = document.getElementById('toggle-sidebar-btn');
        if (toggleSidebarBtn) toggleSidebarBtn.addEventListener('click', toggleSidebar);
        
        // Follow me toggle
        const toggleFollowBtn = document.getElementById('toggle-follow-btn');
        if (toggleFollowBtn) toggleFollowBtn.addEventListener('click', toggleFollowMode);

        // Building overview close button
        const closeOverviewBtn = document.getElementById('close-overview-btn');
        if (closeOverviewBtn) {
            closeOverviewBtn.addEventListener('click', () => {
                const panel = document.getElementById('building-overview');
                if (panel) panel.style.display = 'none';
                state.pendingDestination = null;
                // Close all info windows
                state.markers.forEach(m => m.infoWindow && m.infoWindow.close());
            });
        }

        // Overview "Start Navigation" button
        const overviewNavBtn = document.getElementById('overview-navigate-btn');
        if (overviewNavBtn) {
            overviewNavBtn.addEventListener('click', () => {
                if (state.pendingDestination) {
                    document.getElementById('building-overview').style.display = 'none';
                    startNavigation(state.pendingDestination);
                    state.currentDestination = state.pendingDestination;
                    state.pendingDestination = null;
                }
            });
        }
    });

    function toggleFollowMode() {
        state.isFollowingUser = !state.isFollowingUser;
        const toggleFollowBtn = document.getElementById('toggle-follow-btn');
        if (toggleFollowBtn) {
            toggleFollowBtn.classList.toggle('active', state.isFollowingUser);
        }
        
        if (state.isFollowingUser && state.userLocation) {
            if (state.is3DNavigationMode) {
                // While following in 3D, maintain third-person camera behind arrow
                const heading = state.heading || 0;
                state.map.setHeading(heading);
                updateCamera(state.userLocation, heading);
            } else {
                state.map.panTo(state.userLocation);
            }
        }
    }

    // ============================================
    // INTERACTIVE MODE - LIVE FUNCTIONALITY
    // ============================================

    const interactiveMode = {
        messages: [],
        currentLocation: 'Main Building',
        selectedDestination: null,
        walkingModeActive: false,
        emergencyActive: false,
        zoomLevel: 1,
        otherStudents: [
            { name: 'Student A', position: { top: 40, left: 55 }, direction: 1 }
        ],
        animationId: null
    };

    // Initialize interactive mode handlers
    function initializeInteractiveMode() {
        // Chat functionality
        const chatSendBtn = document.querySelector('.chat-input button');
        const chatInput = document.querySelector('.chat-input input');
        
        if (chatSendBtn && chatInput) {
            chatSendBtn.addEventListener('click', sendChatMessage);
            chatInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    sendChatMessage();
                }
            });
        }
        
        // Action buttons
        const actionButtons = document.querySelectorAll('.card.actions button');
        if (actionButtons.length >= 4) {
            actionButtons[0].addEventListener('click', openDestinationPicker);
            actionButtons[1].addEventListener('click', toggleWalkingMode);
            actionButtons[2].addEventListener('click', showNearbyBuildings);
            actionButtons[3].addEventListener('click', triggerEmergency);
        }
        
        // Search functionality
        const searchInput = document.querySelector('.top-actions input');
        if (searchInput) {
            searchInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    searchBuilding(searchInput.value);
                }
            });
        }
        
        // Notification button
        const notifBtn = document.querySelector('.topbar .notif');
        if (notifBtn) {
            notifBtn.addEventListener('click', showNotifications);
        }
        
        // Start animating other students
        animateOtherStudents();
    }

    // Chat message handler
    function sendChatMessage() {
        const chatInput = document.querySelector('.chat-input input');
        const chatBox = document.querySelector('.chat-box');
        
        if (!chatInput || !chatInput.value.trim() || !chatBox) return;
        
        const message = chatInput.value.trim();
        const userName = state.user || 'You';
        
        // Store message
        interactiveMode.messages.push({
            sender: userName,
            text: message,
            timestamp: new Date()
        });
        
        // Create message element
        const msgEl = document.createElement('p');
        msgEl.style.cssText = 'margin-bottom: 8px; border-bottom: 1px solid #e0e0e0; padding-bottom: 8px;';
        msgEl.innerHTML = `<strong>${userName}:</strong> ${message}`;
        chatBox.appendChild(msgEl);
        
        // Auto-scroll to bottom
        chatBox.scrollTop = chatBox.scrollHeight;
        
        // Clear input
        chatInput.value = '';
        
        // Simulate response from Student A
        setTimeout(() => {
            const responses = [
                "That sounds great!",
                "I'm heading there too!",
                "Do you know where the library is?",
                "Thanks for the info! 👍",
                "I'll see you there!",
                "Just arrived!",
                "On my way!"
            ];
            
            const response = responses[Math.floor(Math.random() * responses.length)];
            const replyEl = document.createElement('p');
            replyEl.style.cssText = 'margin-bottom: 8px; border-bottom: 1px solid #e0e0e0; padding-bottom: 8px; color: #0066cc;';
            replyEl.innerHTML = `<strong>Student A:</strong> ${response}`;
            chatBox.appendChild(replyEl);
            chatBox.scrollTop = chatBox.scrollHeight;
            
            interactiveMode.messages.push({
                sender: 'Student A',
                text: response,
                timestamp: new Date()
            });
        }, 800 + Math.random() * 700);
    }

    // Destination picker
    function openDestinationPicker() {
        const config = CAMPUS_CONFIG[state.campus] || CAMPUS_CONFIG.main;
        
        let modalHTML = '<div style="max-height: 400px; overflow-y: auto;">';
        config.locations.forEach((location, idx) => {
            modalHTML += `
                <div onclick="selectDestination(${idx})" style="padding: 12px; border-bottom: 1px solid #eee; cursor: pointer; transition: all 0.2s; border-radius: 8px; margin-bottom: 4px;" 
                    onmouseover="this.style.background='#f0f0f0'" 
                    onmouseout="this.style.background='transparent'">
                    <strong style="font-size: 14px;">${location.name}</strong>
                    <p style="font-size: 11px; color: #666; margin: 4px 0 0 0;">${location.description.substring(0, 60)}...</p>
                </div>
            `;
        });
        modalHTML += '</div>';
        
        showModal('Select Destination', modalHTML);
    }

    // Select destination
    function selectDestination(idx) {
        const config = CAMPUS_CONFIG[state.campus] || CAMPUS_CONFIG.main;
        const destination = config.locations[idx];
        
        interactiveMode.selectedDestination = destination;
        
        // Close modal
        const modal = document.querySelector('[data-modal="true"]');
        if (modal) modal.remove();
        
        // Update map with destination marker
        const mapContainer = document.querySelector('.map-container');
        const existingDest = mapContainer.querySelector('.marker.destination');
        if (existingDest) existingDest.remove();
        
        const destMarker = document.createElement('div');
        destMarker.className = 'marker destination';
        destMarker.style.cssText = 'position: absolute; background: #ef4444; top: 30%; left: 35%; padding: 6px 10px; border-radius: 999px; color: white; font-size: 12px; z-index: 50;';
        destMarker.textContent = '📍 ' + destination.name.substring(0, 20);
        mapContainer.appendChild(destMarker);
        
        // Show notification
        showNotification(`Destination set to: ${destination.name}`, 'success');
    }

    // Walking mode toggle
    function toggleWalkingMode() {
        interactiveMode.walkingModeActive = !interactiveMode.walkingModeActive;
        const btn = document.querySelector('.card.actions button:nth-child(2)');
        
        if (btn) {
            if (interactiveMode.walkingModeActive) {
                btn.style.background = '#10b981';
                btn.style.color = 'white';
                btn.textContent = '✓ Walking Mode Active';
            } else {
                btn.style.background = '#ffd166';
                btn.style.color = 'black';
                btn.textContent = '🚶 Walking Mode';
            }
        }
        
        showNotification(
            interactiveMode.walkingModeActive ? 'Walking mode activated - GPS tracking enabled' : 'Walking mode deactivated',
            interactiveMode.walkingModeActive ? 'success' : 'info'
        );
    }

    // Show nearby buildings
    function showNearbyBuildings() {
        const config = CAMPUS_CONFIG[state.campus] || CAMPUS_CONFIG.main;
        const nearby = config.locations.slice(0, 6);
        
        let modalHTML = '<div style="max-height: 400px; overflow-y: auto;">';
        nearby.forEach((location) => {
            const distance = Math.floor(Math.random() * 400 + 50);
            modalHTML += `
                <div style="padding: 12px; border-bottom: 1px solid #eee; border-radius: 8px; margin-bottom: 4px;">
                    <strong style="font-size: 14px;">${location.name}</strong>
                    <p style="font-size: 12px; color: #666; margin: 4px 0 0 0;">📍 ~${distance}m away</p>
                </div>
            `;
        });
        modalHTML += '</div>';
        
        showModal('🧭 Nearby Buildings', modalHTML);
    }

    // Emergency trigger
    function triggerEmergency() {
        const btn = document.querySelector('.card.actions .danger');
        
        if (!interactiveMode.emergencyActive) {
            interactiveMode.emergencyActive = true;
            
            if (btn) {
                btn.textContent = '✓ EMERGENCY ACTIVE';
                btn.style.animation = 'pulse 0.8s infinite';
            }
            
            // Add pulse animation
            if (!document.getElementById('pulse-style')) {
                const style = document.createElement('style');
                style.id = 'pulse-style';
                style.textContent = `
                    @keyframes pulse {
                        0%, 100% { opacity: 1; }
                        50% { opacity: 0.6; }
                    }
                `;
                document.head.appendChild(style);
            }
            
            showNotification('🚨 EMERGENCY MODE ACTIVATED - Campus security notified!', 'error');
        } else {
            cancelEmergency();
        }
    }

    // Cancel emergency
    function cancelEmergency() {
        interactiveMode.emergencyActive = false;
        const btn = document.querySelector('.card.actions .danger');
        
        if (btn) {
            btn.textContent = '🚨 Emergency';
            btn.style.animation = 'none';
        }
        
        showNotification('Emergency mode cancelled', 'info');
    }

    // Map zoom in
    function zoomMapIn() {
        interactiveMode.zoomLevel += 0.2;
        const mapContainer = document.querySelector('.map-container');
        if (mapContainer) {
            mapContainer.style.transform = `scale(${interactiveMode.zoomLevel})`;
            mapContainer.style.transformOrigin = 'center center';
            mapContainer.style.transition = 'transform 0.3s ease';
        }
    }

    // Map zoom out
    function zoomMapOut() {
        interactiveMode.zoomLevel = Math.max(0.8, interactiveMode.zoomLevel - 0.2);
        const mapContainer = document.querySelector('.map-container');
        if (mapContainer) {
            mapContainer.style.transform = `scale(${interactiveMode.zoomLevel})`;
            mapContainer.style.transformOrigin = 'center center';
            mapContainer.style.transition = 'transform 0.3s ease';
        }
    }

    // Reset map view
    function resetMapView() {
        interactiveMode.zoomLevel = 1;
        const mapContainer = document.querySelector('.map-container');
        if (mapContainer) {
            mapContainer.style.transform = 'scale(1)';
            mapContainer.style.transition = 'transform 0.3s ease';
        }
        showNotification('Map view reset', 'info');
    }

    // Search building
    function searchBuilding(query) {
        const config = CAMPUS_CONFIG[state.campus] || CAMPUS_CONFIG.main;
        const results = config.locations.filter(loc =>
            loc.name.toLowerCase().includes(query.toLowerCase())
        );
        
        if (results.length > 0) {
            let html = '<div style="max-height: 300px; overflow-y: auto;">';
            results.forEach((loc) => {
                html += `
                    <div onclick="selectDestination(${config.locations.indexOf(loc)})" 
                        style="padding: 12px; border-bottom: 1px solid #eee; cursor: pointer; border-radius: 8px; margin-bottom: 4px;"
                        onmouseover="this.style.background='#f0f0f0'"
                        onmouseout="this.style.background='transparent'">
                        <strong>${loc.name}</strong>
                    </div>
                `;
            });
            html += '</div>';
            showModal('Search Results', html);
        } else {
            showNotification('No buildings found matching your search', 'info');
        }
        
        // Clear search
        const searchInput = document.querySelector('.top-actions input');
        if (searchInput) searchInput.value = '';
    }

    // Show notifications
    function showNotifications() {
        const notifications = [
            'Campus is open today',
            'Library closes at 5 PM',
            'No disruptions reported',
            'All facilities operational'
        ];
        
        let html = '<div style="max-height: 300px; overflow-y: auto;">';
        notifications.forEach(notif => {
            html += `<div style="padding: 12px; border-bottom: 1px solid #eee;">✓ ${notif}</div>`;
        });
        html += '</div>';
        
        showModal('📢 Notifications', html);
    }

    // Animate other students
    function animateOtherStudents() {
        const mapContainer = document.querySelector('.map-container');
        if (!mapContainer) return;
        
        let otherMarker = mapContainer.querySelector('.marker.other');
        
        if (!otherMarker) {
            otherMarker = document.createElement('div');
            otherMarker.className = 'marker other';
            otherMarker.style.cssText = 'position: absolute; background: #3b82f6; padding: 6px 10px; border-radius: 999px; color: white; font-size: 12px; z-index: 40; transition: all 0.1s linear;';
            otherMarker.textContent = '👥 Student A';
            mapContainer.appendChild(otherMarker);
        }
        
        // Animate movement
        let position = 55;
        let direction = 1;
        
        const animate = () => {
            position += direction * 0.3;
            
            if (position > 70 || position < 40) {
                direction *= -1;
            }
            
            otherMarker.style.left = position + '%';
            interactiveMode.animationId = requestAnimationFrame(animate);
        };
        
        animate();
    }

    // Update current location display
    function updateLocationDisplay(location) {
        interactiveMode.currentLocation = location;
        const locationCard = document.querySelector('.card.location h3');
        if (locationCard) {
            locationCard.textContent = location;
        }
    }

    // Generic modal display
    function showModal(title, content) {
        // Remove existing modal
        const existingModal = document.querySelector('[data-modal="true"]');
        if (existingModal) existingModal.remove();
        
        const modal = document.createElement('div');
        modal.setAttribute('data-modal', 'true');
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
            animation: fadeIn 0.3s ease;
        `;
        
        modal.innerHTML = `
            <div style="background: white; border-radius: 16px; padding: 24px; max-width: 500px; width: 90%; max-height: 80vh; box-shadow: 0 20px 60px rgba(0,0,0,0.3);">
                <h3 style="margin: 0 0 16px 0; font-size: 18px; color: #222;">${title}</h3>
                <div style="margin-bottom: 16px;">
                    ${content}
                </div>
                <div style="display: flex; gap: 10px; justify-content: flex-end;">
                    <button onclick="this.closest('[data-modal=true]').remove()" style="padding: 10px 20px; background: #f0f0f0; border: none; border-radius: 8px; cursor: pointer; font-weight: 500;">
                        Close
                    </button>
                </div>
            </div>
        `;
        
        // Add animation
        if (!document.getElementById('modal-style')) {
            const style = document.createElement('style');
            style.id = 'modal-style';
            style.textContent = `
                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
            `;
            document.head.appendChild(style);
        }
        
        document.body.appendChild(modal);
    }

    // Show notification toast
    function showNotification(message, type = 'info', duration = 3000) {
        const notification = document.createElement('div');
        
        const colors = {
            success: '#10b981',
            error: '#ef4444',
            info: '#3b82f6',
            warning: '#f59e0b'
        };
        
        const icons = {
            success: '✓',
            error: '✕',
            info: 'ℹ',
            warning: '⚠'
        };
        
        // Position at header center - right below the navbar, centered horizontally
        notification.style.cssText = `
            position: fixed;
            top: 72px;
            left: 50%;
            transform: translateX(-50%);
            background: ${colors[type]};
            color: white;
            padding: 12px 20px;
            border-radius: 8px;
            z-index: 9999;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            animation: slideIn 0.28s ease-out;
            max-width: 320px;
            font-weight: 600;
            text-align: center;
            font-size: 13px;
        `;
        
        notification.textContent = `${icons[type]} ${message}`;
        document.body.appendChild(notification);
        
        // Add animation
        if (!document.getElementById('toast-style')) {
            const style = document.createElement('style');
            style.id = 'toast-style';
            style.textContent = `
                @keyframes slideDown {
                    from {
                        transform: translateY(-14px);
                        opacity: 0;
                    }
                    to {
                        transform: translateY(0);
                        opacity: 1;
                    }
                }
                @keyframes slideIn {
                    from {
                        transform: translateX(40px);
                        opacity: 0;
                    }
                    to {
                        transform: translateX(0);
                        opacity: 1;
                    }
                }
            `;
            document.head.appendChild(style);
        }
        
        if (duration > 0) {
            setTimeout(() => notification.remove(), duration);
        }
        
        return notification;
    }

    // Show location permission panel with Allow/Don't Allow buttons
    function showLocationPermissionPanel() {
        // Check if panel already exists
        if (document.getElementById('location-permission-panel')) {
            return Promise.reject('Permission panel already shown');
        }
        
        return new Promise((resolve, reject) => {
            const panelOverlay = document.createElement('div');
            panelOverlay.id = 'location-permission-overlay';
            panelOverlay.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0, 0, 0, 0.5);
                z-index: 10000;
                display: flex;
                align-items: center;
                justify-content: center;
            `;
            
            const panel = document.createElement('div');
            panel.id = 'location-permission-panel';
            panel.style.cssText = `
                background: #FFFEF0;
                border: 3px solid #FFB800;
                border-radius: 16px;
                padding: 32px;
                max-width: 380px;
                box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
                text-align: center;
                animation: scaleIn 0.3s ease-out;
                z-index: 10001;
            `;
            
            // Add scale animation
            if (!document.getElementById('permission-style')) {
                const style = document.createElement('style');
                style.id = 'permission-style';
                style.textContent = `
                    @keyframes scaleIn {
                        from {
                            transform: scale(0.9);
                            opacity: 0;
                        }
                        to {
                            transform: scale(1);
                            opacity: 1;
                        }
                    }
                `;
                document.head.appendChild(style);
            }
            
            // Icon
            const icon = document.createElement('div');
            icon.style.cssText = `
                font-size: 48px;
                margin-bottom: 16px;
            `;
            icon.textContent = '📍';
            panel.appendChild(icon);
            
            // Title
            const title = document.createElement('h2');
            title.style.cssText = `
                color: #0F172A;
                font-size: 20px;
                font-weight: 700;
                margin: 0 0 12px 0;
                font-family: 'Inter', sans-serif;
            `;
            title.textContent = 'Location Permission';
            panel.appendChild(title);
            
            // Message
            const message = document.createElement('p');
            message.style.cssText = `
                color: #1F2937;
                font-size: 14px;
                margin: 0 0 28px 0;
                line-height: 1.5;
                font-family: 'Inter', sans-serif;
            `;
            message.textContent = 'PRMSU Navigator needs access to your location to provide campus navigation.';
            panel.appendChild(message);
            
            // Button container
            const buttonContainer = document.createElement('div');
            buttonContainer.style.cssText = `
                display: flex;
                gap: 12px;
                justify-content: center;
            `;
            
            // Don't Allow button
            const denyBtn = document.createElement('button');
            denyBtn.style.cssText = `
                flex: 1;
                padding: 12px 20px;
                background: #E5E7EB;
                color: #0F172A;
                border: 2px solid #D1D5DB;
                border-radius: 8px;
                font-size: 14px;
                font-weight: 600;
                cursor: pointer;
                font-family: 'Inter', sans-serif;
                transition: all 0.2s;
            `;
            denyBtn.textContent = "Don't Allow";
            denyBtn.onmouseover = () => {
                denyBtn.style.background = '#D1D5DB';
            };
            denyBtn.onmouseout = () => {
                denyBtn.style.background = '#E5E7EB';
            };
            denyBtn.onclick = () => {
                panelOverlay.remove();
                reject('Location permission denied by user');
            };
            buttonContainer.appendChild(denyBtn);
            
            // Allow button
            const allowBtn = document.createElement('button');
            allowBtn.style.cssText = `
                flex: 1;
                padding: 12px 20px;
                background: #FFB800;
                color: #0F172A;
                border: 2px solid #FFB800;
                border-radius: 8px;
                font-size: 14px;
                font-weight: 700;
                cursor: pointer;
                font-family: 'Inter', sans-serif;
                transition: all 0.2s;
            `;
            allowBtn.textContent = 'Allow';
            allowBtn.onmouseover = () => {
                allowBtn.style.background = '#F59E0B';
                allowBtn.style.borderColor = '#F59E0B';
            };
            allowBtn.onmouseout = () => {
                allowBtn.style.background = '#FFB800';
                allowBtn.style.borderColor = '#FFB800';
            };
            allowBtn.onclick = () => {
                panelOverlay.remove();
                resolve(true);
            };
            buttonContainer.appendChild(allowBtn);
            
            panel.appendChild(buttonContainer);
            panelOverlay.appendChild(panel);
            document.body.appendChild(panelOverlay);
        });
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeInteractiveMode);
    } else {
        initializeInteractiveMode();
    }

    /* ============================================
    ENHANCED INTERACTIVE MODE
    ============================================ */

    // Global State for Lobby
    const lobbyState = {
        userName: 'Guest User',
        lobbyCode: '---',
        isHost: true,
        participants: [],
        messages: [],
        map: null,
        directionsService: null,
        directionsRenderer: null,
        currentRoutePolyline: null,
        outsideRoutePolyline: null,
        userMarkers: {},
        userLocation: null,
        watchId: null,
        isLocationSharing: false,
        selectedDestination: null,
        walkableRoutePolylines: [],  // Store walkable route polylines for interactive mode
        routeGraph: null,
        campusRouteCoords: [],
        coordToIndex: {},
        campus: 'main'  // Current campus for interactive mode
    };

    // Campus Configuration
    const CAMPUS_CENTER = { lat: 15.3194, lng: 119.9830 };

    // ============================================
    // Initialization
    // ============================================

    window.addEventListener('DOMContentLoaded', function() {
        // Use REAL user from state
        lobbyState.userName = state.user || 'Navigator';
        
        // Initialize UI
        initializeUI();
        
        // Chat input event listener
        const chatInput = document.getElementById('chatInput');
        if (chatInput) {
            chatInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    sendMessage();
                }
            });
        }
    });

    // ============================================
    // UI Initialization
    // ============================================

    function initializeUI() {
        // Update user display name
        const userNameEl = document.getElementById('userName');
        if (userNameEl) {
            userNameEl.textContent = lobbyState.userName;
        }
    }

    // ============================================
    // Lobby Management
    // ============================================

    function generateLobbyCode() {
        return Math.floor(100000 + Math.random() * 900000).toString();
    }

    function copyLobbyCode() {
        const code = document.getElementById('lobbyCodeDisplay').textContent;
        navigator.clipboard.writeText(code).then(() => {
            showNotification('Lobby code copied!', 'success');
        }).catch(() => {
            showNotification('Failed to copy code', 'error');
        });
    }

    function leaveLobby() {
        confirmExit('Leave the lobby and return to mode selection?').then(confirmed => {
            if (confirmed) {
                // Stop location tracking
                if (lobbyState.watchId) {
                    navigator.geolocation.clearWatch(lobbyState.watchId);
                }
                
                // Clear state
                clearNavigationState();
                lobbyState.selectedDestination = null;
                
                // Show back screen
                goToScreen('mode-screen');
                showNotification('Left the lobby', 'info');
                
                // Reset state
                lobbyState.isLocationSharing = false;
            }
        });
    }

    // ============================================
    // Google Maps Integration
    // ============================================

    function initializeMap() {
        const mapElement = document.getElementById('map');
        if (!mapElement) {
            console.error('[MAP LOBBY] Map element #map not found!');
            return;
        }
        
        console.log('[MAP LOBBY] Map element found, checking container hierarchy...');
        
        // Debug: Check parent containers
        const mapContainer = mapElement.parentElement;
        const mapSection = mapContainer?.parentElement;
        const mainContent = mapSection?.parentElement;
        const lobbyContainer = mainContent?.parentElement;
        
        console.log('[MAP LOBBY] mapElement dimensions:', mapElement.offsetWidth, 'x', mapElement.offsetHeight);
        console.log('[MAP LOBBY] mapContainer dimensions:', mapContainer?.offsetWidth, 'x', mapContainer?.offsetHeight);
        console.log('[MAP LOBBY] mapSection dimensions:', mapSection?.offsetWidth, 'x', mapSection?.offsetHeight);
        console.log('[MAP LOBBY] mainContent dimensions:', mainContent?.offsetWidth, 'x', mainContent?.offsetHeight);
        console.log('[MAP LOBBY] lobbyContainer dimensions:', lobbyContainer?.offsetWidth, 'x', lobbyContainer?.offsetHeight);
        
        // Check screen element itself
        const screen = document.getElementById('interactive-screen');
        console.log('[MAP LOBBY] interactive-screen active?', screen?.classList.contains('active'));
        console.log('[MAP LOBBY] interactive-screen display:', window.getComputedStyle(screen).display);
        console.log('[MAP LOBBY] interactive-screen height:', window.getComputedStyle(screen).height);
        
        // Set explicit size - NO CROPPING
        mapElement.style.width = '100%';
        mapElement.style.height = '100%';
        mapElement.style.display = 'block';
        
        // Force reflow
        void mapElement.offsetHeight;
        
        console.log('[MAP LOBBY] After setting styles:');
        console.log('[MAP LOBBY] mapElement dimensions:', mapElement.offsetWidth, 'x', mapElement.offsetHeight);
        
        // If container still has zero dimensions, retry
        if (mapElement.offsetWidth === 0 || mapElement.offsetHeight === 0) {
            console.warn('[MAP LOBBY] Map element still has zero dimensions, retrying in 200ms...');
            setTimeout(() => {
                console.log('[MAP LOBBY] Retry - checking dimensions again:');
                console.log('[MAP LOBBY] mapElement dimensions:', mapElement.offsetWidth, 'x', mapElement.offsetHeight);
                if (mapElement.offsetWidth > 0 && mapElement.offsetHeight > 0) {
                    // Try creating map again
                    initializeMap();
                    return;
                } else {
                    console.error('[MAP LOBBY] Container still 0x0, giving up');
                }
            }, 200);
            return;
        }
        
        const config = CAMPUS_CONFIG[state.campus] || CAMPUS_CONFIG.main;
        
        // Initialize map with EXACT solo mode configuration
        const mapOptions = {
            center: config.center,
            zoom: 18,
            minZoom: 16,
            maxZoom: 21,
            restriction: {
                latLngBounds: config.bounds,
                strictBounds: true
            },
            disableDefaultUI: true,
            zoomControl: false,
            backgroundColor: '#f8fafc',
            mapTypeId: 'satellite',
            mapId: 'bc921b2513c4ace175ad7c43',
            tilt: 45,
            heading: 0,
            gestureHandling: 'greedy'
        };
        
        lobbyState.map = new google.maps.Map(mapElement, mapOptions);
        
        // Initialize REAL directions service and renderer
        lobbyState.directionsService = new google.maps.DirectionsService();
        lobbyState.directionsRenderer = new google.maps.DirectionsRenderer({
            map: lobbyState.map,
            suppressMarkers: false,
            suppressInfoWindows: false
        });
        
        // Apply campus mask (same as solo mode)
        applyInvertedMaskLobby(config.cropCoords);
        
        // Draw red outline to indicate campus boundary restriction (same as solo mode)
        new google.maps.Polygon({
            paths: config.cropCoords,
            strokeColor: '#ff0000',
            strokeOpacity: 0.9,
            strokeWeight: 3,
            fillOpacity: 0,
            map: lobbyState.map
        });
        
        // Build unified route graph from ADDITIONAL_ROUTES (same as solo mode)
        const routeData = buildRouteGraph(ADDITIONAL_ROUTES);
        lobbyState.routeGraph = routeData.graph;
        lobbyState.campusRouteCoords = routeData.allCoords;
        lobbyState.coordToIndex = routeData.coordToIndex;
        
        // Draw all route segments in WHITE (same as solo mode)
        ADDITIONAL_ROUTES.forEach((routeSegment) => {
            const polyline = new google.maps.Polyline({
                path: routeSegment,
                geodesic: true,
                strokeColor: '#FFFFFF',  // White color - EXACT match to solo mode
                strokeOpacity: 0.5,
                strokeWeight: 5,
                map: lobbyState.map
            });
            // Store reference for styling when routes are generated
            lobbyState.walkableRoutePolylines.push(polyline);
        });
        
        // Add location markers with labels (same as solo mode)
        config.locations.forEach(location => {
            const marker = new google.maps.Marker({
                position: { lat: location.lat, lng: location.lng },
                map: lobbyState.map,
                title: location.name,
                zIndex: 100,
                animation: google.maps.Animation.DROP
            });
            
            // Create label overlay (EXACT match to solo mode)
            const labelDiv = document.createElement('div');
            labelDiv.className = 'marker-label';
            labelDiv.textContent = location.name;
            
            class LabelOverlay extends google.maps.OverlayView {
                constructor(position, labelDiv, map) {
                    super();
                    this.position = position;
                    this.labelDiv = labelDiv;
                    this.setMap(map);
                }
                
                onAdd() {
                    this.getPanes().overlayImage.appendChild(this.labelDiv);
                }
                
                draw() {
                    const projection = this.getProjection();
                    if (!projection) return;
                    const pos = projection.fromLatLngToDivPixel(new google.maps.LatLng(this.position.lat, this.position.lng));
                    if (pos) {
                        this.labelDiv.style.left = pos.x + 'px';
                        this.labelDiv.style.top = pos.y + 'px';
                    }
                }
                
                onRemove() {
                    if (this.labelDiv.parentNode) {
                        this.labelDiv.parentNode.removeChild(this.labelDiv);
                    }
                }
            }
            
            new LabelOverlay({ lat: location.lat, lng: location.lng }, labelDiv, lobbyState.map);
            
            // Info window with image support (EXACT match to solo mode)
            const infoWindow = new google.maps.InfoWindow({
                content: `
                    <div style="max-width: 250px; padding: 8px;">
                        <h3 style="margin: 0 0 10px 0; color: #1a3a8a; font-size: 1.1em; font-weight: 700;">${location.name}</h3>
                        <p style="margin: 0 0 10px 0; color: #475569; line-height: 1.5;">${location.description}</p>
                        ${location.image ? `<img src="${location.image}" style="width: 100%; height: auto; border-radius: 8px; margin-top: 8px;" alt="${location.name}" />` : ''}
                    </div>
                `
            });
            
            marker.addListener('click', () => {
                // Select this location in the destinations list dropdown
                const destItems = document.querySelectorAll('.destination-item');
                destItems.forEach(item => {
                    if (item.textContent.trim() === location.name) {
                        item.classList.add('selected');
                    } else {
                        item.classList.remove('selected');
                    }
                });

                // Also set the textbox value
                const searchInput = document.getElementById('destSearchInput');
                if (searchInput) {
                    searchInput.value = location.name;
                }

                // HOST: clicking a marker sets it as the shared destination for the whole lobby
                if (multiplayerState && multiplayerState.isHosting && multiplayerState.isInLobby) {
                    setSharedDestination({
                        name: location.name,
                        lat: location.lat,
                        lng: location.lng
                    });
                    showNotification(`📍 Destination set: ${location.name}`, 'success');
                    return;
                }

                // Non-host solo fallback (no multiplayer)
                if (lobbyState.userLocation) {
                    drawRouteToDestination(location.name, { lat: location.lat, lng: location.lng });
                }
            });
        });
        
        // Trigger map idle to ensure proper sizing
        google.maps.event.addListenerOnce(lobbyState.map, 'idle', () => {
            google.maps.event.trigger(lobbyState.map, 'resize');
        });
    }

    // ============================================
    // Location Sharing
    // ============================================

    function applyInvertedMaskLobby(coords) {
        if (!coords || !lobbyState.map) return;
        const bounds = CAMPUS_CONFIG.main.bounds;
        const outerBounds = [
            { lat: bounds.north, lng: bounds.west },
            { lat: bounds.north, lng: bounds.east },
            { lat: bounds.south, lng: bounds.east },
            { lat: bounds.south, lng: bounds.west },
            { lat: bounds.north, lng: bounds.west }
        ];
        
        new google.maps.Polygon({
            paths: [outerBounds, coords.map(c => ({ lat: c.lat, lng: c.lng }))],
            strokeWeight: 0,
            fillColor: "#000000",
            fillOpacity: 0.4,
            map: lobbyState.map,
            zIndex: 1,
            clickable: false
        });
    }

    function toggleLocationSharing() {
        console.log('[LOC-SHARE] toggleLocationSharing called');
        const btn = document.getElementById('shareLocationBtn');
        
        if (!lobbyState.isLocationSharing) {
            // Start location sharing
            if (navigator.geolocation) {
                lobbyState.watchId = navigator.geolocation.watchPosition(
                    updateUserLocation,
                    handleLocationError,
                    {
                        enableHighAccuracy: true,
                        timeout: 10000,
                        maximumAge: 0
                    }
                );
                
                lobbyState.isLocationSharing = true;
                btn.classList.add('active');
                btn.innerHTML = `
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"></circle>
                        <circle cx="12" cy="12" r="3"></circle>
                    </svg>
                    Sharing Location
                `;
                showNotification('Location sharing enabled', 'success');
                console.log('[LOC-SHARE] Location sharing started');
            } else {
                showNotification('Geolocation not supported', 'error');
            }
        } else {
            // Stop location sharing
            if (lobbyState.watchId) {
                navigator.geolocation.clearWatch(lobbyState.watchId);
            }
            
            // Remove user marker
            if (lobbyState.userMarkers[lobbyState.userName]) {
                lobbyState.userMarkers[lobbyState.userName].setMap(null);
                delete lobbyState.userMarkers[lobbyState.userName];
            }
            
            lobbyState.isLocationSharing = false;
            btn.classList.remove('active');
            btn.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"></circle>
                    <circle cx="12" cy="12" r="3"></circle>
                </svg>
                Share Location
            `;
            showNotification('Location sharing disabled', 'info');
            console.log('[LOC-SHARE] Location sharing stopped');
        }
    }

    function updateUserLocation(position) {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        
        lobbyState.userLocation = { lat, lng };
        console.log('[USER-LOC] User location updated:', lat, lng);
        
        // Check if map exists
        if (!lobbyState.map) {
            console.warn('[USER-LOC] Map not ready yet, will retry in 500ms');
            setTimeout(() => updateUserLocation(position), 500);
            return;
        }
        
        // Sync current user location with participants list (for real-time sharing)
        const currentUserParticipant = lobbyState.participants.find(p => p.isCurrentUser);
        if (currentUserParticipant) {
            currentUserParticipant.location = { lat, lng };
        }
        
        // Update or create marker
        if (lobbyState.userMarkers[lobbyState.userName]) {
            console.log('[USER-LOC] Updating existing marker for', lobbyState.userName);
            lobbyState.userMarkers[lobbyState.userName].setPosition({ lat, lng });
        } else {
            console.log('[USER-LOC] Creating new marker for', lobbyState.userName);
            lobbyState.userMarkers[lobbyState.userName] = new google.maps.Marker({
                position: { lat, lng },
                map: lobbyState.map,
                title: lobbyState.userName + ' (You)',
                icon: {
                    path: google.maps.SymbolPath.CIRCLE,
                    scale: 12,
                    fillColor: '#3B82F6',
                    fillOpacity: 1,
                    strokeColor: '#FFFFFF',
                    strokeWeight: 3
                },
                animation: google.maps.Animation.DROP,
                zIndex: 1000
            });
            
            console.log('[USER-LOC] Marker created successfully');
            
            // Add info window
            const infoWindow = new google.maps.InfoWindow({
                content: `
                    <div style="padding: 8px; text-align: center;">
                        <strong style="color: #0F172A;">${lobbyState.userName}</strong>
                        <p style="margin: 4px 0 0 0; color: #64748B; font-size: 0.85rem;">Your Location</p>
                    </div>
                `
            });
            
            lobbyState.userMarkers[lobbyState.userName].addListener('click', () => {
                infoWindow.open(lobbyState.map, lobbyState.userMarkers[lobbyState.userName]);
            });
        }
        
        // Center map on user location to ensure it's visible
        if (lobbyState.map) {
            lobbyState.map.setCenter({ lat, lng });
        }
        
        // Check if user is outside campus and suggest nearest gate
        const isOutside = !isInsideCampus(lat, lng);
        if (isOutside) {
            const nearestGate = findNearestGate(lat, lng);
            if (nearestGate) {
                console.log('[USER-LOC] User outside campus, suggesting gate:', nearestGate.name);
                showOutsideCampusNotice(nearestGate.name);
            }
        }
        
        // Update location display
        updateCurrentLocation(lat, lng);
        
        // Broadcast location to other users via socket
        if (window.socket && window.socket.connected) {
            window.socket.emit('locationUpdate', {
                userId: lobbyState.userName,
                lat: lat,
                lng: lng,
                heading: 0,
                timestamp: new Date()
            });
            console.log('[USER-LOC] Location broadcasted via socket');
        }
    }

    function handleLocationError(error) {
        console.error('Location error:', error);
        showNotification('Unable to get location', 'error');
    }

    function updateCurrentLocation(lat, lng) {
        // Update location display
        const locationEl = document.getElementById('currentLocation');
        if (locationEl) {
            locationEl.textContent = 'Main Campus';
        }
    }



    // Draw REAL route using Google Directions
    function drawRouteToDestination(destName, destination) {
        if (!lobbyState.map || !lobbyState.userLocation || !lobbyState.directionsService) return;
        
        const request = {
            origin: new google.maps.LatLng(lobbyState.userLocation.lat, lobbyState.userLocation.lng),
            destination: new google.maps.LatLng(destination.lat, destination.lng),
            travelMode: 'WALKING'
        };
        
        lobbyState.directionsService.route(request, (result, status) => {
            if (status === google.maps.DirectionsStatus.OK) {
                // Remove old route
                if (lobbyState.currentRoutePolyline) {
                    lobbyState.currentRoutePolyline.setMap(null);
                }
                
                const isOutside = isLocationOutsideCampus(destination.lat, destination.lng);
                const routeColor = isOutside ? '#3B82F6' : '#FFB800';
                
                // Draw REAL polyline route
                lobbyState.currentRoutePolyline = new google.maps.Polyline({
                    path: result.routes[0].overview_path,
                    geodesic: true,
                    strokeColor: routeColor,
                    strokeOpacity: 0.85,
                    strokeWeight: 6,
                    map: lobbyState.map,
                    zIndex: 100
                });
                
                const distance = Math.round(result.routes[0].legs[0].distance.value / 1000);
                addSystemMessage(`📍 Route to ${destName}: ${distance}m away`);
            }
        });
    }

    // Check if location is outside campus
    function isLocationOutsideCampus(lat, lng) {
        const campusRadius = 0.005; // approximately 500 meters
        const config = CAMPUS_CONFIG[state.campus] || CAMPUS_CONFIG.main;
        const latDistance = Math.abs(lat - config.center.lat);
        const lngDistance = Math.abs(lng - config.center.lng);
        const distance = Math.sqrt(latDistance * latDistance + lngDistance * lngDistance);
        return distance > campusRadius;
    }



    // ============================================
    // Participants Management
    // ============================================

    function addParticipant(name, isCurrentUser = false) {
        // Check if participant already exists
        if (lobbyState.participants.find(p => p.name === name)) return;
        
        lobbyState.participants.push({ 
            name, 
            online: true, 
            isCurrentUser,
            location: isCurrentUser ? lobbyState.userLocation : null  // Only current user has real location
        });
        updateParticipantsList();
        updateActiveUsersCount();
        
        if (!isCurrentUser) {
            addSystemMessage(`${name} joined the lobby`);
        }
    }

    function updateParticipantLocation(name, location) {
        const participant = lobbyState.participants.find(p => p.name === name);
        if (participant) {
            participant.location = location;
            
            // Create or update marker for this participant
            if (!lobbyState.userMarkers[name]) {
                const marker = new google.maps.Marker({
                    position: location,
                    map: lobbyState.map,
                    title: name,
                    icon: {
                        path: google.maps.SymbolPath.CIRCLE,
                        scale: 13,
                        fillColor: '#10B981',
                        fillOpacity: 1,
                        strokeColor: '#FFFFFF',
                        strokeWeight: 3
                    },
                    animation: google.maps.Animation.DROP,
                    zIndex: 999
                });
                
                lobbyState.userMarkers[name] = marker;
                
                const infoWindow = new google.maps.InfoWindow({
                    content: `<div style="padding: 10px; text-align: center; font-family: Inter, sans-serif;"><strong style="color: #0F172A; font-size: 0.95rem;">${name}</strong><p style="margin: 4px 0 0 0; color: #10B981; font-size: 0.8rem; font-weight: 600;">● Online</p></div>`,
                    pixelOffset: new google.maps.Size(0, -35)
                });
                
                marker.addListener('click', () => {
                    infoWindow.open(lobbyState.map, marker);
                });
            } else {
                // Update existing marker position
                lobbyState.userMarkers[name].setPosition(location);
            }
            
            // Draw route to participant if user location is available
            if (lobbyState.userLocation) {
                drawRouteToDestination(name, location);
            }
        }
    }

    function updateParticipantsList() {
        const listEl = document.getElementById('participantsList');
        listEl.innerHTML = '';
        
        lobbyState.participants.forEach((participant, index) => {
            const box = document.createElement('div');
            box.className = `user-box ${participant.isCurrentUser ? 'current' : ''}`;
            
            // Get location text
            let locationText = 'No location';
            if (participant.location) {
                // Check if location is outside campus
                const isOutside = isLocationOutsideCampus(participant.location.lat, participant.location.lng);
                if (isOutside) {
                    locationText = 'Outside Campus';
                } else {
                    locationText = `${participant.location.lat.toFixed(4)}, ${participant.location.lng.toFixed(4)}`;
                }
            }
            
            // Show username (with navigator label) only for current user
            let nameDisplay = participant.name;
            if (participant.isCurrentUser) {
                nameDisplay = `${participant.name}<br><span style="font-size: 0.65rem; color: var(--blue); font-weight: 600;">(Navigator)</span>`;
            }
            
            box.innerHTML = `
                <div class="user-name">${nameDisplay}</div>
                <div class="user-location">${locationText}</div>
            `;
            
            listEl.appendChild(box);
        });
    }

    function updateActiveUsersCount() {
        const count = lobbyState.participants.length;
        document.getElementById('participantCount').textContent = count;
    }

    // ============================================
    // Chat Functions
    // ============================================

    function sendMessage() {
        const input = document.getElementById('chatInput');
        const message = input.value.trim();
        
        if (!message) return;
        
        addChatMessage(lobbyState.userName, message);
        input.value = '';
        // Note: In a real app, this would be sent to actual participants via WebSocket or similar
    }

    function addChatMessage(sender, text) {
        const messagesEl = document.getElementById('chatMessages');
        const messageEl = document.createElement('div');
        messageEl.className = 'chat-message user-message';
        
        const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        messageEl.innerHTML = `
            <div style="flex: 1;">
                <div class="message-sender">
                    ${sender}
                    <span class="message-time">${time}</span>
                </div>
                <div class="message-text">${escapeHtml(text)}</div>
            </div>
        `;
        
        messagesEl.appendChild(messageEl);
        messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function addSystemMessage(text) {
        const messagesEl = document.getElementById('chatMessages');
        const messageEl = document.createElement('div');
        messageEl.className = 'chat-message system-message';
        
        messageEl.innerHTML = `
            <span class="message-icon">ℹ️</span>
            <span class="message-text">${escapeHtml(text)}</span>
        `;
        
        messagesEl.appendChild(messageEl);
        messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    // ============================================
    // Lobby Map Functions
    // ============================================

    function centerMap() {
        if (lobbyState.userLocation) {
            lobbyState.map.setCenter(lobbyState.userLocation);
            lobbyState.map.setZoom(18);
        } else {
            const config = CAMPUS_CONFIG[state.campus] || CAMPUS_CONFIG.main;
            lobbyState.map.setCenter(config.center);
            lobbyState.map.setZoom(17);
        }
    }

    function goToMyLocation() {
        if (lobbyState.userLocation) {
            lobbyState.map.setCenter(lobbyState.userLocation);
            lobbyState.map.setZoom(19);
            showNotification('Centered on your location', 'success');
        } else {
            showNotification('Location not available. Enable location sharing first.', 'error');
        }
    }

    // ============================================
    // Utility Functions
    // ============================================

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function showToast(message, type = 'success') {
        const toast = document.getElementById('toast') || document.createElement('div');
        toast.textContent = message;
        toast.className = `toast ${type} show`;
        
        if (!document.getElementById('toast')) {
            toast.id = 'toast';
            document.body.appendChild(toast);
        }
        
        setTimeout(() => {
            toast.classList.remove('show');
        }, 3000);
    }

    // ============================================
    // Initialize Interactive Mode on Screen Show
    // ============================================

    // Hook into showScreen to initialize map when interactive-screen is shown
    const originalShowScreen = window.showScreen;
    window.showScreen = function(screenId) {
        originalShowScreen.call(this, screenId);
        
        // Hide/show main navigation based on active screen
        const mainNav = document.querySelector('.main-nav');
        if (mainNav) {
            if (screenId === 'solo-screen' || screenId === 'interactive-screen') {
                mainNav.style.display = 'none';
            } else {
                mainNav.style.display = '';
            }
        }
        
        if (screenId === 'interactive-screen') {
            // Initialize lobby when screen is shown
            lobbyState.lobbyCode = generateLobbyCode();
            document.getElementById('lobbyCodeDisplay').textContent = lobbyState.lobbyCode;
            
            // Add current user as participant
            addParticipant(lobbyState.userName, true);
            
            // Initialize map - IMPORTANT: Wait longer to ensure DOM layout is complete
            // Use requestAnimationFrame twice to ensure layout calculations are done
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    setTimeout(() => {
                        console.log('[INIT-MAP] Starting map initialization after full layout...');
                        try {
                            initializeMap();
                            addSystemMessage(`Welcome to the lobby, ${lobbyState.userName}!`);
                            
                            // Auto-start location sharing for all users in lobby
                            console.log('[INIT-MAP] Auto-starting location sharing...');
                            toggleLocationSharing();
                        } catch (error) {
                            console.error('[INIT-MAP] Error initializing map:', error);
                            // Retry after 500ms
                            setTimeout(() => {
                                console.log('[INIT-MAP] Retrying map initialization...');
                                initializeMap();
                                // Retry location sharing as well
                                toggleLocationSharing();
                            }, 500);
                        }
                    }, 250);
                });
            });
        }
    }

    // ============================================
    // Username Management
    // ============================================
    function openChangeUsernameModal() {
        const modal = document.getElementById('changeUsernameModal');
        const input = document.getElementById('newUsernameInput');
        if (modal && input) {
            modal.classList.remove('hidden');
            modal.style.display = 'flex';
            input.value = state.user || '';
            input.focus();
            input.select();
        }
    }

    function closeChangeUsernameModal() {
        const modal = document.getElementById('changeUsernameModal');
        if (modal) {
            modal.classList.add('hidden');
            modal.style.display = 'none';
        }
    }

    function saveNewUsername() {
        const input = document.getElementById('newUsernameInput');
        if (!input || !input.value.trim()) {
            showNotification('Please enter a username', 'warning', 5000);
            input.focus();
            return;
        }

        const newUsername = input.value.trim();
        state.user = newUsername;
        
        // Save to localStorage for IP-based persistence
        localStorage.setItem('prmsuUsername', newUsername);
        console.log('[AUTH] Username updated:', newUsername);
        
        // Update UI
        const userStatusDisplay = document.getElementById('user-status-display');
        if (userStatusDisplay) {
            userStatusDisplay.textContent = `Welcome, ${newUsername}`;
        }

        // Show confirmation
        showNotification('✓ Username updated successfully!', 'success', 3000);

        closeChangeUsernameModal();
    }

    // ============================================
    // Main Sidebar Management
    // ============================================
    function toggleMainSidebar() {
        const sidebar = document.getElementById('main-sidebar');
        const overlay = document.getElementById('main-sidebar-overlay');
        const hamburgerBtn = document.getElementById('main-sidebar-toggle');
        
        if (sidebar && overlay) {
            const isOpen = sidebar.classList.contains('open');
            
            if (isOpen) {
                sidebar.classList.remove('open');
                overlay.classList.remove('open');
                if (hamburgerBtn) hamburgerBtn.setAttribute('aria-expanded', 'false');
            } else {
                sidebar.classList.add('open');
                overlay.classList.add('open');
                if (hamburgerBtn) hamburgerBtn.setAttribute('aria-expanded', 'true');
            }
        }
    }

    // ============================================
    // Dark Mode Management
    // ============================================
    function toggleDarkMode() {
        const html = document.documentElement;
        const isDarkMode = html.getAttribute('data-theme') === 'dark';
        const newTheme = isDarkMode ? 'light' : 'dark';
        
        html.setAttribute('data-theme', newTheme);
        localStorage.setItem('prmsuTheme', newTheme);
        
        // Update checkbox state
        const checkbox = document.getElementById('dark-mode-checkbox');
        if (checkbox) {
            checkbox.checked = newTheme === 'dark';
        }
        
        console.log('[THEME] Dark mode toggled:', newTheme);
    }

    // Initialize theme on page load
    function initializeTheme() {
        const savedTheme = localStorage.getItem('prmsuTheme') || 'light';
        const html = document.documentElement;
        html.setAttribute('data-theme', savedTheme);
        
        // Restore checkbox state
        const checkbox = document.getElementById('dark-mode-checkbox');
        if (checkbox) {
            checkbox.checked = savedTheme === 'dark';
        }
    }

    // Call on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeTheme);
    } else {
        initializeTheme();
    }

    // Set up event listeners for sidebar and dark mode
    document.addEventListener('DOMContentLoaded', function() {
        // Hamburger button to toggle sidebar
        const hamburgerBtn = document.getElementById('main-sidebar-toggle');
        if (hamburgerBtn) {
            hamburgerBtn.addEventListener('click', toggleMainSidebar);
        }

        // Dark mode checkbox
        const darkModeCheckbox = document.getElementById('dark-mode-checkbox');
        if (darkModeCheckbox) {
            darkModeCheckbox.addEventListener('change', toggleDarkMode);
        }

        // Close sidebar when clicking on overlay
        const overlay = document.getElementById('main-sidebar-overlay');
        if (overlay) {
            overlay.addEventListener('click', function() {
                const sidebar = document.getElementById('main-sidebar');
                if (sidebar && sidebar.classList.contains('open')) {
                    toggleMainSidebar();
                }
            });
        }
    });

        // Close sidebar when clicking on overlay
        const overlay = document.getElementById('main-sidebar-overlay');
        if (overlay) {
            overlay.addEventListener('click', function() {
                const sidebar = document.getElementById('main-sidebar');
                if (sidebar && sidebar.classList.contains('open')) {
                    toggleMainSidebar();
                }
            });
        }
    

    // Close sidebar when user selects a campus
    const originalShowRegistrationModal = window.showRegistrationModal;
    if (originalShowRegistrationModal) {
        window.showRegistrationModal = function(isNewUser = true) {
            toggleMainSidebar(); // Close sidebar
            originalShowRegistrationModal(isNewUser);
        };
    }

    // ============================================
    // Cleanup
    // ============================================

    window.onbeforeunload = function() {
        if (lobbyState.watchId) {
            navigator.geolocation.clearWatch(lobbyState.watchId);
        }
    };
