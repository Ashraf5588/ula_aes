const path = require("path");

const fs= require("fs");
const express = require("express");
const app = express();
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
const { rootDir } = require("../utils/path");
const { studentSchema } = require("../model/schema");
const { studentrecordschema } = require("../model/adminschema");
const { classSchema, subjectSchema,terminalSchema } = require("../model/adminschema");
const { name } = require("ejs");
const subjectlist = mongoose.model("subjectlist", subjectSchema, "subjectlist");
const studentClass = mongoose.model("studentClass", classSchema, "classlist");
const studentRecord = mongoose.model("studentRecord", studentrecordschema, "studentrecord");
const bcrypt = require("bcrypt");
const terminal = mongoose.model("terminal", terminalSchema, "terminal");
app.set("view engine", "ejs");
app.set("view", path.join(rootDir, "views"));

// Helper function to fetch sidenav data
const getSidenavData = async (req) => {
  try {
    const subjects = await subjectlist.find({}).lean();
    const studentClassdata = await studentClass.find({}).lean();
    const terminals = await terminal.find({}).lean();
    
    let accessibleSubject = [];
    let accessibleClass = [];
    
    // Check if req exists and has user property
    if (req && req.user) {
      const user = req.user;
      // Log user info for debugging
      if (user && user.role) {
        console.log('User role:', user.role);
        console.log('User allowed subjects:', user.allowedSubjects || []);
      } else {
        console.log('User object exists but missing role or allowedSubjects');
      }
      
      if (user.role === "ADMIN") {
        accessibleSubject = subjects;
        accessibleClass = studentClassdata;
      } else {
        // Filter subjects based on user's allowed subjects
        accessibleSubject = subjects.filter(subj =>
          user.allowedSubjects && user.allowedSubjects.some(allowed =>
            allowed.subject === subj.subject
          )
        );
        
        // Filter classes based on user's allowed classes/sections
        accessibleClass = studentClassdata.filter(classItem =>
          user.allowedSubjects && user.allowedSubjects.some(allowed =>
            allowed.studentClass === classItem.studentClass && 
            allowed.section === classItem.section
          )
        );
        
        console.log('Filtered subjects:', accessibleSubject.length);
        console.log('Filtered classes:', accessibleClass.length);
      }
    } else {
      // If no user is found, return all data (default admin view)
      console.log('No user found in request, returning all data');
      accessibleSubject = subjects;
      accessibleClass = studentClassdata;
    }
    
    return {
      subjects: accessibleSubject,
      studentClassdata: accessibleClass,
      terminals
    };
  } catch (error) {
    console.error('Error fetching sidenav data:', error);
    return {
      subjects: [],
      studentClassdata: [],
      terminals: []
    };
  }
};
exports.allowedSubjectData = (user, subjects, studentClass, section) => {
  if (user.role === "ADMIN") {
    // Admin has access to everything, so return all subjects/classes/sections as arrays from DB
    // Assuming subjects param is array of all subject docs from DB
    const allSubjects = Array.isArray(subjects)
      ? subjects.map(s => s.subject)
      : [subjects];

    // For classes and sections, collect unique from user's allowedSubjects or all if admin
    // For demo, returning '*'
    return {
      accessibleSubjects: allSubjects,
      accessibleClasses: ['*'],
      accessibleSections: ['*']
    };
  }

  // Normalize allowedSubjects for easy lookup
  const allowedSubs = user.allowedSubjects.map(a => a.subject);
  const allowedClasses = user.allowedSubjects.map(a => a.studentClass);
  const allowedSections = user.allowedSubjects.map(a => a.section);

  // Filter subjects param based on allowedSubjects
  let filteredSubjects = [];

  if (Array.isArray(subjects)) {
    filteredSubjects = subjects
      .filter(s => allowedSubs.includes(s.subject))
      .map(s => s.subject);
  } else if (typeof subjects === 'string') {
    if (allowedSubs.includes(subjects)) filteredSubjects.push(subjects);
  }

  // Filter classes
  let filteredClasses = [];
  if (studentClass) {
    filteredClasses = allowedClasses.includes(studentClass) ? [studentClass] : [];
  } else {
    filteredClasses = Array.from(new Set(allowedClasses));
  }

  // Filter sections
  let filteredSections = [];
  if (section) {
    filteredSections = allowedSections.includes(section) ? [section] : [];
  } else {
    filteredSections = Array.from(new Set(allowedSections));
  }

  return {
    accessibleSubjects: Array.from(new Set(filteredSubjects)),
    accessibleClasses: Array.from(new Set(filteredClasses)),
    accessibleSections: Array.from(new Set(filteredSections))
  };
};



const getSubjectModel = (subjectinput, studentClass, section, terminal) => {
  // to Check if model already exists
  if (mongoose.models[`${subjectinput}_${studentClass}_${section}_${terminal}`]) {
    return mongoose.models[`${subjectinput}_${studentClass}_${section}_${terminal}`];
  }
  return mongoose.model(`${subjectinput}_${studentClass}_${section}_${terminal}`, studentSchema, `${subjectinput}_${studentClass}_${section}_${terminal}`);
};

// Helper function to safely get subject data and handle errors with case insensitivity
const getSubjectData = async (subjectinput, forClass, res) => {
  try {
    // First try exact match
    let currentSubject = await subjectlist.find({'subject': `${subjectinput}`, forClass: forClass})
    
    // If no results, try case-insensitive search
    if (!currentSubject || currentSubject.length === 0) {
      // Try case-insensitive search using a regular expression
      currentSubject = await subjectlist.find({
        'subject': { $regex: new RegExp(`^${subjectinput}$`, 'i') }, forClass: forClass
      });
    }
    
    if (!currentSubject || currentSubject.length === 0) {
      // Check if any subjects exist at all
      const allSubjects = await subjectlist.find({}).lean();
      const subjectsList = allSubjects.map(s => s.subject).join(', ');
      
      if (res) {
        res.status(404).render('404', {
          errorMessage: `Subject '${subjectinput}' not found in the database. Available subjects: ${subjectsList || 'None'}`,
          currentPage: 'teacher'
        });
      }
      return null;
    }
    return currentSubject[0];
  } catch (err) {
    console.error(`Error in getSubjectData: ${err.message}`);
    if (res) {
      res.status(500).render('404', {
        errorMessage: `Server error while looking up subject '${subjectinput}': ${err.message}`,
        currentPage: 'teacher'
      });
    }
    return null;
  }
};
exports.homePage = async (req, res, next) => {

  
  const subject = await subjectlist.find({}).lean();

  const studentClassdata = await studentClass.find({}).lean();
  const terminals = await terminal.find({}).lean();
  const user = req.user;
  let accessibleSubject =[];
  let accessibleClass=[];
  if(user.role==="ADMIN")
  {
    accessibleSubject = subject;
    accessibleClass = studentClassdata;
  }
  else
  {
   accessibleSubject = subject.filter(subject =>
      user.allowedSubjects.some(allowed =>
        allowed.subject === subject.subject
      )
    );
    accessibleClass = studentClassdata.filter(studentclass =>
      user.allowedSubjects.some(allowed =>
        allowed.studentClass === studentclass.studentClass &  allowed.section === studentclass.section
      )
    );
  }
 
  res.render("index", { 
    currentPage: "home",
    subjects: accessibleSubject, 
    studentClassdata:accessibleClass,
    terminals 
  });
};
// Edit student (get data for the form)
exports.editStudent = async (req, res, next) => {
  const { studentId, subjectinput, studentClass, section, terminal } = req.params;
  const {controller} = req.query;
  try {
    console.log(`Editing student ID: ${studentId} from collection: ${subjectinput}_${studentClass}_${section}_${terminal}`);
    
    // Find student by ID
    const model = getSubjectModel(subjectinput, studentClass, section, terminal);
    const studentToEdit = await model.findById(studentId).lean();
    
    if (!studentToEdit) {
      console.log(`Student with ID ${studentId} not found in collection ${subjectinput}_${studentClass}_${section}_${terminal}`);
      return res.status(404).render('404', {
        errorMessage: `Student record with ID ${studentId} not found in subject ${subjectinput}, class ${studentClass}, section ${section}, terminal ${terminal}`,
        currentPage: 'teacher'
      });
    }

    console.log(`Found student: ${studentToEdit.name} (Roll: ${studentToEdit.roll})`);

    res.render("admin/edit-student", { 
      student: studentToEdit,
      controller,
      ...(await getSidenavData(req))
    });
  } catch (err) {
    console.error(`Error editing student: ${err.message}`);
    console.error(`Parameters: studentId=${studentId}, subject=${subjectinput}, class=${studentClass}, section=${section}, terminal=${terminal}`);
    res.status(500).render('404', {
      errorMessage: `Error editing student: ${err.message}`,
      currentPage: 'teacher'
    });
  }
};

// Update student (save the modified data)
exports.updateStudent = async (req, res, next) => {
  const { studentId, subjectinput, studentClass, section, terminal } = req.params;
  const updatedData = req.body;
  const { controller} = req.query;
  console.log(req.url)
  console.log(controller);
  
  try {
    console.log(`Updating student ID: ${studentId} in collection: ${subjectinput}_${studentClass}_${section}_${terminal}`);
    
    // Get the model for the specific collection
    const model = getSubjectModel(subjectinput, studentClass, section, terminal);
    
    // First check if the student exists
    const existingStudent = await model.findById(studentId);
    
    if (!existingStudent) {
      console.log(`Student with ID ${studentId} not found in collection ${subjectinput}_${studentClass}_${section}_${terminal}`);
      return res.status(404).render('404', {
        errorMessage: `Student record with ID ${studentId} not found in subject ${subjectinput}, class ${studentClass}, section ${section}, terminal ${terminal}`,
        currentPage: 'teacher'
      });
    }
    
    // Update the student record
    const updatedStudent = await model.findByIdAndUpdate(studentId, updatedData, { new: true });
    
    if (!updatedStudent) {
      return res.status(500).render('404', {
        errorMessage: `Failed to update student record with ID ${studentId}`,
        currentPage: 'teacher'
      });
    }
    
    console.log(`Successfully updated student: ${updatedStudent.name} (ID: ${studentId})`);
    
    // Redirect back to the student list

    res.redirect(`/${controller}/${subjectinput}/${studentClass}/${section}/${terminal}`);
  } catch (err) {
    console.error(`Error updating student: ${err.message}`);
    console.error(`Parameters: studentId=${studentId}, subject=${subjectinput}, class=${studentClass}, section=${section}, terminal=${terminal}`);
    res.status(500).render('404', {
      errorMessage: `Error updating student: ${err.message}`,
      currentPage: 'teacher'
    });
  }
};

// Delete student
exports.deleteStudent = async (req, res, next) => {
  
  const { studentId,subjectinput,studentClass,section,terminal} = req.params;
  const model = getSubjectModel(subjectinput,studentClass,section,terminal);
  const {controller} = req.query;
  try {
   
    // Delete the student record
    await model.findByIdAndDelete(studentId);
    res.redirect(`/${controller}/${subjectinput}/${studentClass}/${section}/${terminal}`);  // Redirect to admin dashboard or any page you prefer
  } catch (err) {
    console.error(err);
    next(err);
  }
};

exports.teacherPage = async (req, res, next) => {
  const subjects = await subjectlist.find({});
  const { controller } = req.params;
  
  // Get sidenav data
  const sidenavData = await getSidenavData(req);
  
  res.render("teacher", { 
    controller, 
    currentPage: "teacher", 
    subjects,
    ...sidenavData 
  });
};

exports.studentclass = async (req, res, next) => {
  const studentClassdata = await studentClass.find({});

  const { subject, controller } = req.params;

  // Get sidenav data
  const sidenavData = await getSidenavData(req);
   const user = req.user;

  let accessibleClass=[];
  if(user.role==="ADMIN")
  {
   
    accessibleClass = studentClassdata;
  }
  else
  {
   
    accessibleClass = studentClassdata.filter(studentclass =>
      user.allowedSubjects.some(allowed =>
        allowed.studentClass === studentclass.studentClass  && allowed.section === studentclass.section
      )
    );
  }

  res.render("class", { 
    subject, 
    controller, 
    studentClassdata: accessibleClass,
    ...sidenavData 
  });
};
exports.terminal = async (req, res, next) => {
  const { controller, subject, studentClass, section } = req.params;
  const terminalList = await terminal.find({}).lean();
  
  // Get sidenav data
  const sidenavData = await getSidenavData(req);
  
  res.render("terminal", { 
    subject, 
    controller, 
    studentClass, 
    section, 
    terminalList,
    ...sidenavData 
  });
};


exports.showForm = async (req, res, next) => {
  const { subjectinput,studentClass, section, terminal } = req.params;
  const user = req.user

const subjects = await subjectlist.find({ forClass: `${studentClass}`, subject: `${subjectinput}` })

  const model = getSubjectModel(subjectinput, studentClass, section, terminal);
      const totalcountmarks = await model.find({ subject: `${subjectinput}`, section: `${section}`, terminal: `${terminal}`, studentClass: `${studentClass}` },
      { roll: 1, name: 1 ,totalMarks: 1,_id:1,studentClass:1,section:1,subject:1}).lean();

 global.availablesubject = subjects.map((sub) => sub.subject);
  if(!terminal || terminal === "''" || terminal=== '"')
  {
    terminal=''
  }
  


  
  // Get total entries count for this subject, class, and section
  let totalEntries = 0;
  if (availablesubject.includes(subjectinput)) {
    try {
      const model = getSubjectModel(subjectinput, studentClass, section, terminal);
     
      const entriesCount = await model.aggregate([
        {
          $match: {
            $and: [
              { studentClass: studentClass },
              { section: section },
              { terminal: terminal }
            ],
          },
        },
        { $count: "count" },
      ]);
      
      totalEntries = entriesCount.length > 0 && entriesCount[0].count
        ? entriesCount[0].count
        : 0;
        
    } catch (err) {
      console.log(err);
    }
  }  if (!availablesubject.includes(subjectinput)) {
    return res.render("gotoquestion");
  } else {

  



    res.render("form", {
      subjectname: subjectinput,
      section,
      studentClass,
      terminal,
      subjects,
      totalEntries,
      forClass: studentClass,
      totalcountmarks,
      ...(await getSidenavData(req))
    });
  }
};

exports.saveForm = async (req, res, next) => {
  const { subjectinput } = req.params;
  const { studentClass, section, terminal } = req.params;

  const subjects = await subjectlist.find({ forClass: `${studentClass}` ,subject:`${subjectinput}`}).lean();

  console.log(subjects);
 
  global.availablesubject = subjects.map((sub) => sub.subject);
  if (!availablesubject.includes(subjectinput)) {
    return res.render("404");
  } else {
    try {
      const model = getSubjectModel(subjectinput, studentClass, section, terminal);
      await model.create(req.body);
      res.render("FormPostMessage", {
        subjectinput,
        studentClass,
        section,
        terminal,
        forClass: studentClass,
        ...(await getSidenavData(req))
      });
    } catch (err) {
      console.log(err);
    }
  }
};

exports.findData = async (req, res) => {
  try {

    const {
      subjectinput,
      studentClass,
      section,
      terminal,
    } = req.params;
 if (!studentClass || studentClass === '') {
      return res.status(404).render('404', {
        errorMessage: 'Class parameter is missing or empty',
        currentPage: 'teacher'
      });
    }
     const subjectExists = await subjectlist.findOne({ 
      subject: subjectinput, 
      forClass: studentClass 
    });
    
    if (!subjectExists) {
      return res.status(404).render('404', {
        errorMessage: `Subject '${subjectinput}' does not exist for Class ${studentClass}`,
        currentPage: 'teacher'
      });
    }
    

  


    const subjectData = await getSubjectData(subjectinput,studentClass,section,terminal, res);


    if (!subjectData) {
      console.log(`No subject data found for ${subjectinput}`);
      return;
    }
    
    const model = getSubjectModel(subjectinput,studentClass, section, terminal);

   



//check the data of collection social
    






    const totalstudent = await model.aggregate([
      {
        $match: {
          $and: [{ section: `${section}` }, { terminal: `${terminal}` }, { studentClass: `${studentClass}` }],
        },
      },
      { $count: "count" },
    ]);
    
    const totalStudent =
      totalstudent.length > 0 && totalstudent[0].count
        ? totalstudent[0].count
        : 0;
        
    
    
    let result = [];
    // let obtained=[];
    let Correct=[], inCorrect=[], fifty=[], CorrectAbove50=[], CorrectBelow50=[];
    avg = [];
    let total=[];
let sub = await model.find({ subject: `${subjectinput}`, studentClass: `${studentClass}`, section: `${section}`, terminal: `${terminal}` }, { _id: 0, __v: 0 }).lean();
if (sub && sub.length > 0) {
 total = Object.keys(sub[0]).slice(7).map(qno=>
{
  const t = sub.reduce((sum,obtainedmarks)=>{
      return sum + (obtainedmarks[qno] ?? 0);
  },0)
  return {qno,t};
}

);
}


    const max = parseInt(subjectData.max)

// Build result array for DataTable with question-wise statistics
for (let i = 1; i <= max; i++) {
  let n = subjectData[i][0]
  if(subjectData[i]===0){n=1}
  for (j = 0; j < n; j++) {
    const questionKey = `q${i}${String.fromCharCode(97+j)}`;
    const fullMarks = parseFloat(subjectData[i.toString()][j+1]);
    
    // Get the total marks for this question
    const questionTotal = total.find(t => t.qno === questionKey);
    const totalMarksForQuestion = questionTotal ? questionTotal.t : 0;
    
    // Calculate average percentage
    const averagePercentage = totalStudent > 0 ? (totalMarksForQuestion / (totalStudent * fullMarks)) * 100 : 0;
    
    // Count students in each category
    const correctCount = await model.countDocuments({
      subject: `${subjectinput}`,studentClass: `${studentClass}`, section: `${section}`, terminal: `${terminal}`,
      [questionKey]: fullMarks
    });
    
    const incorrectCount = await model.countDocuments({
      subject: `${subjectinput}`,studentClass: `${studentClass}`, section: `${section}`, terminal: `${terminal}`,
      [questionKey]: 0
    });
    
    const fiftyCount = await model.countDocuments({
      subject: `${subjectinput}`,studentClass: `${studentClass}`, section: `${section}`, terminal: `${terminal}`,
      [questionKey]: 0.5 * fullMarks
    });
    
    const above50Count = await model.countDocuments({
      subject: `${subjectinput}`,studentClass: `${studentClass}`, section: `${section}`, terminal: `${terminal}`,
      [questionKey]: { $gt: 0.5 * fullMarks, $lt: fullMarks }
    });
    
    const below50Count = await model.countDocuments({
      subject: `${subjectinput}`,studentClass: `${studentClass}`, section: `${section}`, terminal: `${terminal}`,
      [questionKey]: { $lt: 0.5 * fullMarks, $gt: 0 }
    });
    
   
    
    result.push({
      questionNo: questionKey,
      correct: correctCount,
      wrong: incorrectCount,
     
      correctabove50: above50Count,
      correctbelow50: below50Count,
      fifty: fiftyCount,
      averagePercentage: averagePercentage.toFixed(2),
      totalMarks: totalMarksForQuestion,
      fullMarks: fullMarks
    });
  }
}

// Sort result by wrong count (most wrong first)
result.sort((a, b) => b.wrong - a.wrong);
let s= 0;
    for (let i = 1; i <= max; i++) {
      let n = subjectData[i][0]
      if(subjectData[i]===0){n=1}
      for (j = 0; j < n; j++) {
          
           let fullMarks=parseFloat(subjectData[i.toString()][j+1]) 
           
             
            //       const data = await model.find({subject: `${subjectinput}`,studentClass: `${studentClass}`, section: `${section}`, terminal: `${terminal}`}, { _id: 0, __v: 0 }).lean();
            //         data.forEach((item) => {
            //         s=s+item[`q${i}${String.fromCharCode(97+j)}`];
            //  });
            //  avg.push({
            //   qno: `q${i}${String.fromCharCode(97+j)}`,
              
            //   average: (s / data.length),
            // });
            

 const inCorrectData = await model.find({
  subject: `${subjectinput}`,studentClass: `${studentClass}`, section: `${section}`, terminal: `${terminal}`,
  [`q${i}${String.fromCharCode(97+j)}`]: 0,
}, { _id: 0,[`q${i}${String.fromCharCode(97+j)}`]:1,name:1,roll:1 }).lean();
inCorrect.push({
 qno: `q${i}${String.fromCharCode(97+j)}`,
 studentName: inCorrectData.map(item => item.name),
 total: inCorrectData.length,
  fullMarks: fullMarks,
obtainedMarks:inCorrectData.map(item=>item[`q${i}${String.fromCharCode(97+j)}`]),
});
const CorrectData = await model.find({
  subject: `${subjectinput}`,studentClass: `${studentClass}`, section: `${section}`, terminal: `${terminal}`,
  [`q${i}${String.fromCharCode(97+j)}`]: fullMarks,
}, { _id: 0,[`q${i}${String.fromCharCode(97+j)}`]:1,name:1,roll:1 }).lean();
Correct.push({
  qno: `q${i}${String.fromCharCode(97+j)}`,
  studentName: CorrectData.map(item => item.name),
  total: CorrectData.length,
  fullMarks: fullMarks,
  obtainedMarks:CorrectData.map(item=>item[`q${i}${String.fromCharCode(97+j)}`]),
});
const fiftyData = await model.find({
  subject: `${subjectinput}`,studentClass: `${studentClass}`, section: `${section}`, terminal: `${terminal}`,
  [`q${i}${String.fromCharCode(97+j)}`]:  0.5 * fullMarks,
}, { _id: 0,[`q${i}${String.fromCharCode(97+j)}`]:1,name:1,roll:1 }).lean();

fifty.push({
  qno: `q${i}${String.fromCharCode(97+j)}`,
  studentName: fiftyData.map(item => item.name),
  total: fiftyData.length,
  fullMarks: fullMarks,
  obtainedMarks:fiftyData.map(item=>item[`q${i}${String.fromCharCode(97+j)}`]),
});

const CorrectAbove50Data = await model.find({
  subject: `${subjectinput}`,studentClass: `${studentClass}`, section: `${section}`, terminal: `${terminal}`,
  [`q${i}${String.fromCharCode(97+j)}`]: { $gt: 0.5 * fullMarks, $lt: fullMarks },
}, { _id: 0,[`q${i}${String.fromCharCode(97+j)}`]:1,name:1,roll:1 }).lean();
CorrectAbove50.push({ 
  qno: `q${i}${String.fromCharCode(97+j)}`,
  studentName: CorrectAbove50Data.map(item => item.name),
  total: CorrectAbove50Data.length,
  fullMarks: fullMarks,
  obtainedMarks:CorrectAbove50Data.map(item=>item[`q${i}${String.fromCharCode(97+j)}`]),
});
const CorrectBelow50Data = await model.find({
  subject: `${subjectinput}`,studentClass: `${studentClass}`, section: `${section}`, terminal: `${terminal}`,
  [`q${i}${String.fromCharCode(97+j)}`]: { $lt: 0.5 * fullMarks, $gt: 0 },
}, { _id: 0,[`q${i}${String.fromCharCode(97+j)}`]:1,name:1,roll:1 }).lean();

CorrectBelow50.push({
  qno: `q${i}${String.fromCharCode(97+j)}`,
  studentName: CorrectBelow50Data.map(item => item.name),
  total: CorrectBelow50Data.length,
  fullMarks: fullMarks,
  obtainedMarks:CorrectBelow50Data.map(item=>item[`q${i}${String.fromCharCode(97+j)}`]),
});

       

       
       
      }
    }

  
    
   
// showing q1a = incorrect student name


    const allArr = [];


  for (let i = 1; i <= max; i++) {
    let n = subjectData[i]
    if(subjectData[i]===0){n=1}
    for (j = 0; j < n; j++) {

  const incorrectStudentData = await model.find({subject:`${subjectinput}`,section:`${section}`,terminal:`${terminal}`,studentClass:`${studentClass}`,[`q${i}${String.fromCharCode(97+j)}`]:'incorrect'})
allArr.push({
  questionNo: `q${i}${String.fromCharCode(97+j)}`,
  studentClass: studentClass,
  section: section,
  terminal: terminal,
  studentname:incorrectStudentData.name
    });
}

  }


try {

const paper = await subjectlist.findOne({ subject: `${subjectinput}`, forClass: `${studentClass}` }, { questionPaperOfClass: 1,_id:0 });

let file = 'default.pdf'; // Default fallback
let fileStatus = 'default'; // 'default', 'found', 'missing'

if(paper && paper.questionPaperOfClass && paper.questionPaperOfClass !== '') {
  const requestedFile = paper.questionPaperOfClass;
  const {rootDir} = require("../utils/path");
  
  console.log(`🔍 Looking for question paper: ${requestedFile}`);
  
  // If the database has a .docx file, check if it was converted to PDF
  let actualFilePath = `${rootDir}/uploads/${requestedFile}`;
  let actualFileName = requestedFile;
  
  if (requestedFile.endsWith('.docx')) {
    const pdfFileName = requestedFile.replace('.docx', '.pdf');
    const pdfFilePath = `${rootDir}/uploads/${pdfFileName}`;
    
    console.log(`📝 Database has DOCX file, checking for converted PDF: ${pdfFileName}`);
    
    // Check if PDF version exists (from conversion)
    if (fs.existsSync(pdfFilePath)) {
      actualFileName = pdfFileName;
      actualFilePath = pdfFilePath;
      fileStatus = 'found';
      console.log(`✅ Converted PDF found: ${pdfFileName}`);
    } else if (fs.existsSync(actualFilePath)) {
      // PDF doesn't exist but DOCX does - conversion might have failed
      fileStatus = 'found';
      console.log(`⚠️ Only DOCX file exists (conversion may have failed): ${requestedFile}`);
    } else {
      // Neither PDF nor DOCX exists
      console.log(`❌ Neither PDF nor DOCX file exists for: ${requestedFile}`);
      actualFileName = 'default.pdf';
      fileStatus = 'missing';
    }
  } else {
    // For non-DOCX files (direct PDF uploads), check normally
    if (fs.existsSync(actualFilePath)) {
      fileStatus = 'found';
      console.log(`✅ Question paper found: ${requestedFile}`);
    } else {
      console.log(`⚠️ Question paper file missing: ${requestedFile}, falling back to default.pdf`);
      actualFileName = 'default.pdf';
      fileStatus = 'missing';
    }
  }
  
  file = actualFileName;
} else {
  console.log(`📝 No question paper specified, using default.pdf`);
  fileStatus = 'default';
}

const totalcountmarks = await model.find({ subject: `${subjectinput}`, section: `${section}`, terminal: `${terminal}`, studentClass: `${studentClass}` },
      { roll: 1, name: 1 ,totalMarks: 1,_id:1,studentClass:1,section:1,subject:1}).lean();
module.exports = totalcountmarks;

const classList = mongoose.model("studentClass", classSchema, "classlist");
const classlisttotal = await classList.find({}).lean();
const classlistData = new Set(classlisttotal.map(item => item.studentClass));

    res.render("analysis", {
      results: result,
      totalcountmarks,
      subjectname: subjectinput,
      studentClass,
      section,
      totalStudent,
classlistData,
      terminal,
      Correct,
      inCorrect,  
      fifty,
      CorrectAbove50,
      CorrectBelow50,
      file, 
      fileStatus, // Pass file status to view
      originalFile: paper?.questionPaperOfClass || '', // Pass original filename for display
      total,
      ...(await getSidenavData(req))
    });
} catch (err) {
  console.error(`Error fetching question paper for ${subjectinput} in class ${studentClass}: ${err.message}`);
  return;
}



  } catch (err) {
    console.log(err);
  }
};




exports.termwisestatus = async (req,res,next)=>{
  const sidenavData = await getSidenavData(req);
  res.render('termstatus', { ...sidenavData });
};

exports.termwisedata = async (req,res,next)=>{
let term = [];
const {subjectinput,studentClass,section,terminal,status} = req.params; 
const model = getSubjectModel(subjectinput,studentClass,section,terminal);

  // Use the helper function to safely get subject data
  const subjectData = await getSubjectData(subjectinput,studentClass,res);

  // If subject data is null, the helper function has already sent a response
  if (!subjectData) {
    return;
  }
    const max = parseInt(subjectData.max)
  try {
  for (let i = 1; i <= max; i++) {
    let n = subjectData[i]
    if(subjectData[i]===0){n=1}
    for (j = 0; j < n; j++) {
     
        const term1data = await model.find(
          {
            [`q${i}${String.fromCharCode(97+j)}`]: `${status}`,
            terminal: "first",studentClass:`${studentClass}`,section:`${section}`
          },
          { roll: 1, name: 1, _id: 0, [`q${i}${String.fromCharCode(97+j)}`]: 1 }
        );

        const term2data = await model.find(
          {
            [`q${i}${String.fromCharCode(97+j)}`]: `${status}`,
            terminal: "second",studentClass:`${studentClass}`,section:`${section}`
          },
          { roll: 1, name: 1, _id: 0, [`q${i}${String.fromCharCode(97+j)}`]: 1 }
        );
        const term3data = await model.find(
          {
            [`q${i}${String.fromCharCode(97+j)}`]: `${status}`,
            terminal: "third",studentClass:`${studentClass}`,section:`${section}`
          },
          { roll: 1, name: 1, _id: 0, [`q${i}${String.fromCharCode(97+j)}`]: 1 }
        );
        

        const incorrect2roll = new Set(term2data.map(item=>item.roll))
        const incorrect3roll = new Set(term3data.map(item=>item.roll))
        const common12 = term1data.filter(student=>incorrect2roll.has(student.roll))
        const count12 = common12.length
        const common13 = term1data.filter(student=>incorrect3roll.has(student.roll))
        const count13 = common13.length
        const common23 = term2data.filter(student=>incorrect3roll.has(student.roll))
        const count23 = common23.length
        const common123 = term1data.filter(student=>incorrect2roll.has(student.roll) && incorrect3roll.has(student.roll))
        const count123 = common123.length
        
        term.push({
          questionNo: `q${i}${String.fromCharCode(97+j)}`,
          data12:count12,
          data13:count13,
          data23:count23,
          data123:count123,
          namedata12:common12,
          namedata13:common13,
          namedata23:common23,
          namedata123:common123,

        });
      }
    }
    res.render('termwiseanalysis',{term,status,...(await getSidenavData(req))})
  }catch(err)
  {
    console.log(err)
  }
  
};
exports.termdetail = async (req,res,next)=>
{
  const {subjectinput,studentClass,section,status,qno,terminal} = req.params;
  let term = [];
  const model = getSubjectModel(subjectinput,studentClass,section,terminal);
   
  // Explicitly extract questionNo from the route parameter qno for the view
  const questionNo = qno;
    
    try {
    
       
          const term1data = await model.find(
            {
              [`${qno}`]: `${status}`,
              terminal: "first",studentClass:`${studentClass}`,section:`${section}`
            },
            { roll: 1, name: 1, _id: 0, [`${qno}`]: 1 }
          );
  
          const term2data = await model.find(
            {
              [`${qno}`]: `${status}`,
              terminal: "second",studentClass:`${studentClass}`,section:`${section}`
            },
            { roll: 1, name: 1, _id: 0, [`${qno}`]: 1 }
          );
          const term3data = await model.find(
            {
              [`${qno}`]: `${status}`,
              terminal: "third",studentClass:`${studentClass}`,section:`${section}`
            },
            { roll: 1, name: 1, _id: 0, [`${qno}`]: 1 }
          );
          
  
          const incorrect2roll = new Set(term2data.map(item=>item.roll))
          const incorrect3roll = new Set(term3data.map(item=>item.roll))
          const common12 = term1data.filter(student=>incorrect2roll.has(student.roll))
          
          const common13 = term1data.filter(student=>incorrect3roll.has(student.roll))
         
          const common23 = term2data.filter(student=>incorrect3roll.has(student.roll))
          
          const common123 = term1data.filter(student=>incorrect2roll.has(student.roll) && incorrect3roll.has(student.roll))
   
            term.push({
            questionNo: qno,
           
            namedata12:common12,
            namedata13:common13,
            namedata23:common23,
            namedata123:common123,
          });
          
          
      res.render('termdetail',{term,subjectinput,studentClass,section,status,qno,terminal,questionNo,...(await getSidenavData(req))})
    }catch(err)
    {
      console.log(err)
    }




}
exports.search = async (req, res, next) => {
  const { subject, studentClass, section, terminal } = req.params;
  const { roll } = req.body;

  const model = getSubjectModel(subject, studentClass, section, terminal);
  const individualData = await model
    .find(
      {
        subject: `${subject}`,
        section: `${section}`,
        terminal: `${terminal}`,
        roll: roll,
        studentClass: `${studentClass}`,
      },
      { _id: 0, __v: 0 }
    )
    .lean();

  res.render("search", {
    individualData,
    subject,
    studentClass,
    section,
    terminal,
    ...(await getSidenavData(req))
  });
};
exports.studentData = async (req, res, next) => {
  const { subjectinput, studentClass, section, qno, status, terminal } =
    req.params;
  model = getSubjectModel(subjectinput, studentClass, section, terminal);
  const StudentData = await model.find({
    $and: [
      { [`${qno}`]: `${status}` },
      { section: `${section}` },
      { terminal: `${terminal}` },
    ],
  });

  res.render("studentdata", {
    subjectinput,
    qno,
    status,
    StudentData,
    studentClass,
    section,
    terminal,
    ...(await getSidenavData(req))
  });
};

  exports.totalStudent = async (req, res, next) => {
    const { subjectinput, studentClass, section, terminal } = req.params;
    const model = getSubjectModel(subjectinput, studentClass, section, terminal);
    const incorrectdata = [];
    
    try {
      // Use the helper function to safely get subject data
      const subjectData = await getSubjectData(subjectinput,studentClass,section,terminal, res);
      if (!subjectData) {
        console.log(`No subject data found for ${subjectinput}`);
        return;
      } 
      // If subject data is null, the helper function has already sent a response
      if (!subjectData) {
        return;
      }
  
      const max = parseInt(subjectData.max);
      
      for (let i = 1; i <= max; i++) {
        let n = subjectData[i] || 1;  // Ensure n is at least 1
  
        for (let j = 0; j <= n; j++) {
          const incorrectname = await model.find({
            studentClass: studentClass,
            section: section,
            terminal: terminal,
            [`q${i}${String.fromCharCode(97 + j)}`]: "incorrect",
          });
  
          incorrectname.forEach(student => {
            incorrectdata.push({
              questionNo: `q${i}${String.fromCharCode(97 + j)}`,
              studentname: student.name,  // Extract names correctly
            });
          });
  
         
        }
      }
  
      const totalStudent = await model
        .find({ studentClass, section, terminal })
        .lean();
  
      res.render("totalstudent", {
        totalStudent,
        subjectinput,
        studentClass,
        section,
        terminal,
        incorrectdata,  // Pass incorrect answers list to the frontend
        ...(await getSidenavData(req))
      });
  
    } catch (error) {
      console.error("Error fetching students:", error);
      res.status(500).json({ message: "Server error" });
    }
  };


exports.updateQuestion = async (req, res, next) => {
  const { no } = req.params;
  
};

exports.studentrecord = async (req, res, next) => {
  
  
   const roll = parseInt(req.query.roll?.trim());
   
   const { studentClass, section, terminal } = req.params;
   let dbSection = section.toUpperCase();
   if (!section || section === '') {
     return res.status(404).render('404', {
       errorMessage: 'Section parameter is missing or empty',
       currentPage: 'teacher'
     });
   }
 console.log(roll)
 console.log(section)

  try{

const regex = new RegExp(`^${dbSection}\\s*`, 'i');

      const record = await studentRecord.find({section:regex,
    roll: roll,studentClass:studentClass})

  res.json(record);
  }catch(err)
  {
    res.status(500).json({ error: err.message });
  }
};
exports.checkroll = async (req,res,next) =>
{
const {subjectinput,studentClass,section,terminal} = req.params;
const {roll} = req.query;
const model = getSubjectModel(subjectinput,studentClass,section,terminal);

const exist = await model.findOne({studentClass:studentClass,section:section,subject:subjectinput,roll:roll,terminal:terminal})
if(exist)
{
  res.json({studentName: exist.name, roll: exist.roll, section: exist.section, studentClass: exist.studentClass, terminal: exist.terminal, subject: exist.subject, totalMarks: exist.totalMarks });
}
else
{
  res.json(false)
}
};

